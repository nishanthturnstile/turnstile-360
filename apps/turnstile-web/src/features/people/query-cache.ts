import { QueryClient, type QueryKey } from '@tanstack/react-query';
import type { PeopleDomain } from './cache-events';

export const PEOPLE_STALE_MS = 30_000;
export const PEOPLE_GC_MS = 300_000;
export type PeopleScope = readonly ['people', string, string];
export const peopleScope = (userId: string, fingerprint: string): PeopleScope => [
  'people',
  userId,
  fingerprint,
];
export function peopleQueryKey(scope: PeopleScope, revision: unknown, url: string) {
  const [path, search] = url.split('?');
  const params = new URLSearchParams(search);
  params.sort();
  return [...scope, revision, `${path}${params.size ? `?${params}` : ''}`] as const;
}
export const inPeopleScope = (key: QueryKey, scope: PeopleScope) =>
  key[0] === scope[0] && key[1] === scope[1] && key[2] === scope[2];
export function queryDomain(key: QueryKey) {
  const path = String(key.at(-1)).split('?')[0] ?? '';
  if (path.startsWith('/api/structure/')) return 'structure';
  if (path.startsWith('/api/organization')) return 'organization';
  return path.split('/')[3];
}
export function createPeopleQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: PEOPLE_STALE_MS,
        gcTime: PEOPLE_GC_MS,
        retry: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
      },
      mutations: { retry: false },
    },
  });
}
export async function invalidatePeopleDomains(
  client: QueryClient,
  scope: PeopleScope,
  domains: readonly PeopleDomain[],
) {
  const filters = {
    predicate: (query) =>
      inPeopleScope(query.queryKey, scope) &&
      domains.includes(queryDomain(query.queryKey) as PeopleDomain),
  } satisfies Parameters<QueryClient['cancelQueries']>[0];
  await client.cancelQueries(filters);
  await client.invalidateQueries({ ...filters, refetchType: 'none' });
}
export async function invalidatePeopleScope(client: QueryClient, scope: PeopleScope) {
  const filters = {
    predicate: (query: { queryKey: QueryKey }) => inPeopleScope(query.queryKey, scope),
  };
  await client.cancelQueries(filters);
  await client.invalidateQueries({ ...filters, refetchType: 'none' });
}
export function retirePeopleScopes(client: QueryClient, scope: PeopleScope, active: boolean) {
  for (const query of client.getQueryCache().getAll())
    if (!active || !inPeopleScope(query.queryKey, scope)) {
      void client.cancelQueries({ queryKey: query.queryKey, exact: true });
      client.removeQueries({ queryKey: query.queryKey, exact: true });
    }
}
export function refreshVerifiedPeopleQueries(client: QueryClient, scope: PeopleScope) {
  return client.refetchQueries(
    { predicate: (query) => inPeopleScope(query.queryKey, scope), type: 'active', stale: true },
    { cancelRefetch: false },
  );
}
export async function refreshPeopleQuery(client: QueryClient, key: QueryKey) {
  await client.cancelQueries({ queryKey: key, exact: true });
  await client.invalidateQueries({ queryKey: key, exact: true });
}
