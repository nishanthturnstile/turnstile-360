import { useQueryClient } from '@tanstack/react-query';
import type { UserSessionDto } from '@thaarei/turnstile-contracts/runtime';
import { useEffect, useRef, useState } from 'react';
import { DocumentsError, documentsErrorMessage } from './client';

export type DocumentsToolProps = {
  session: UserSessionDto;
  active: boolean;
  onCheck: (fresh?: boolean) => Promise<boolean>;
};

export function documentsScope(session: UserSessionDto) {
  return ['documents', session.user.id, session.access.fingerprint, session.access.accessRevision];
}

export function useDocumentWork({ session, active, onCheck }: DocumentsToolProps) {
  const cache = useQueryClient();
  const scope = documentsScope(session);
  const attempt = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    if (!active) attempt.current?.abort();
    return () => attempt.current?.abort();
  }, [active]);
  function run(work: (signal: AbortSignal) => Promise<void>) {
    if (!active || attempt.current) return;
    const controller = new AbortController();
    attempt.current = controller;
    setBusy(true);
    setMessage('');
    void work(controller.signal)
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof DocumentsError && [401, 403].includes(error.status)) void onCheck();
        setMessage(documentsErrorMessage(error));
      })
      .finally(() => {
        attempt.current = null;
        setBusy(false);
        if (!controller.signal.aborted) void cache.invalidateQueries({ queryKey: scope });
      });
  }
  return { scope, busy, message, setMessage, run };
}
