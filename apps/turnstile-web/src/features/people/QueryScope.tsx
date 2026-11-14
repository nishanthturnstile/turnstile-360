import { QueryClientProvider } from '@tanstack/react-query';
import type { UserSessionDto } from '@thaarei/turnstile-contracts';
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { subscribePeopleWrites } from './cache-events';
import { PeopleError } from './client';
import {
  createPeopleQueryClient,
  inPeopleScope,
  invalidatePeopleDomains,
  invalidatePeopleScope,
  type PeopleScope,
  peopleScope,
  refreshVerifiedPeopleQueries,
  retirePeopleScopes,
} from './query-cache';

const Scope = createContext<PeopleScope | null>(null);
export function usePeopleScope() {
  const scope = useContext(Scope);
  if (!scope) throw new Error('People queries require their session boundary');
  return scope;
}
export function PeopleQueryScope({
  session,
  active,
  onCheck,
  verification,
  children,
}: {
  session: UserSessionDto;
  active: boolean;
  onCheck: (fresh?: boolean) => Promise<boolean>;
  verification: number;
  children: ReactNode;
}) {
  const [client] = useState(createPeopleQueryClient);
  const scope = useMemo(
    () => peopleScope(session.user.id, session.access.fingerprint),
    [session.user.id, session.access.fingerprint],
  );
  const current = useRef({ scope, active, onCheck });
  current.current = { scope, active, onCheck };
  const deniedCheck = useRef<Promise<boolean> | undefined>(undefined);
  useLayoutEffect(() => {
    // No previous user/permission generation remains addressable after an auth transition.
    retirePeopleScopes(client, scope, active);
  }, [client, scope, active]);
  const revision = session.access.accessRevision;
  const previousRevision = useRef(revision);
  useLayoutEffect(() => {
    // The global revision also changes for edits that do not change this actor's grants.
    if (previousRevision.current !== revision) void invalidatePeopleScope(client, scope);
    previousRevision.current = revision;
  }, [client, scope, revision]);
  // The workspace owner advances this only after its live authority checks succeed.
  // Cached data stays visible while stale active reads refresh; inactive tabs wait until visited.
  useEffect(() => {
    if (active && verification) void refreshVerifiedPeopleQueries(client, scope);
  }, [client, scope, active, verification]);
  useLayoutEffect(
    () =>
      subscribePeopleWrites((domains) => {
        void invalidatePeopleDomains(client, scope, domains);
      }),
    [client, scope],
  );
  useEffect(
    () =>
      client.getQueryCache().subscribe((event) => {
        if (event.type !== 'updated' || event.action.type !== 'error') return;
        const error = event.query.state.error;
        if (
          !(error instanceof PeopleError) ||
          ![401, 403].includes(error.status) ||
          !current.current.active ||
          !inPeopleScope(event.query.queryKey, current.current.scope)
        )
          return;
        // Drop inactive protected results, keep this error visible, and ask the live auth owner.
        client.removeQueries({ type: 'inactive' });
        if (deniedCheck.current) return;
        const result = current.current.onCheck().catch(() => false);
        deniedCheck.current = result;
        void result.finally(() => {
          if (deniedCheck.current === result) deniedCheck.current = undefined;
        });
      }),
    [client],
  );
  useEffect(() => () => client.clear(), [client]);
  return (
    <QueryClientProvider client={client}>
      <Scope value={scope}>{children}</Scope>
    </QueryClientProvider>
  );
}
