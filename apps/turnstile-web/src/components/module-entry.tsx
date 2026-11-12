import {
  type BusinessModuleId,
  type ModuleCapabilitiesDto,
  type ModuleEntryDto,
  moduleEntrySchema,
  type UserSessionDto,
} from '@thaarei/turnstile-contracts';
import { useEffect, useState } from 'react';
import { ContentLoading } from '@/components/content-loading';
import { Notice } from '@/components/notice';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty';
import { ProductError, productRequest } from '@/features/auth/product';
export type ModulePageProps = {
  session: UserSessionDto;
  capabilities: ModuleCapabilitiesDto | undefined;
  onCheck: () => Promise<boolean>;
};
export function GuardedModuleEntry({
  id,
  title,
  session,
  capabilities,
  onCheck,
}: ModulePageProps & { id: BusinessModuleId; title: string }) {
  const available = !!capabilities?.modules.some((m) => m.id === id);
  const [result, setResult] = useState<{ key: string; value?: ModuleEntryDto; failed: boolean }>();
  const [attempt, setAttempt] = useState(0);
  const requestKey = JSON.stringify([
    id,
    session.user.id,
    session.access.fingerprint,
    capabilities?.context?.policyRevision,
    capabilities?.context?.profileDigest,
    attempt,
  ]);
  useEffect(() => {
    let current = true;
    if (available)
      void productRequest(`/api/modules/${id}/entry`, { schema: moduleEntrySchema })
        .then((value) => {
          if (current)
            setResult(
              value.id === id
                ? { key: requestKey, value, failed: false }
                : { key: requestKey, failed: true },
            );
        })
        .catch((error) => {
          if (!current) return;
          setResult({ key: requestKey, failed: true });
          if (error instanceof ProductError && [401, 403, 409].includes(error.status))
            void onCheck();
        });
    return () => {
      current = false;
    };
  }, [available, id, onCheck, requestKey]);
  const value = result?.key === requestKey ? result : undefined;
  if (!available)
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>
            <h1>Module access unavailable</h1>
          </EmptyTitle>
          <EmptyDescription>
            You don’t currently have access to this module. Contact your workspace administrator if
            you need access.
          </EmptyDescription>
        </EmptyHeader>
        <Button variant="outline" onClick={() => void onCheck()}>
          Check access
        </Button>
      </Empty>
    );
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1>{title}</h1>
        </CardTitle>
        <CardDescription>Your workspace module</CardDescription>
      </CardHeader>
      <CardContent>
        {value?.failed ? (
          <div className="flex flex-col gap-4">
            <Notice message="We couldn’t open this module. Check your access or try again." />
            <Button
              variant="outline"
              className="self-start"
              onClick={() => setAttempt((v) => v + 1)}
            >
              Try again
            </Button>
          </div>
        ) : value?.value ? (
          <p>{value.value.message}</p>
        ) : (
          <ContentLoading label="Opening module…" />
        )}
      </CardContent>
    </Card>
  );
}
