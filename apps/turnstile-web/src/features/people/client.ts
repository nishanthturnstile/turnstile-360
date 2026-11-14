import {
  PEOPLE_ERROR_STATUS,
  PEOPLE_FEATURES_HEADER,
  PEOPLE_IMPORT_FEATURE,
  PEOPLE_LIMITS,
  PEOPLE_ROUTES,
  peopleCommandResultSchema,
  peopleCommandSchema,
  peopleErrorSchema,
  type UserSessionDto,
} from '@thaarei/turnstile-contracts';
import { capturePeopleWrite } from './cache-events.ts';
export class PeopleError extends Error {
  readonly status: number;
  readonly code: string;
  readonly reason: string | undefined;
  constructor(status: number, code: string, reason?: string) {
    super(code);
    this.status = status;
    this.code = code;
    this.reason = reason;
  }
}
export async function request<T>(
  path: string,
  schema: { parse(value: unknown): T },
  options: {
    method?: string;
    body?: unknown;
    csrf?: string;
    key?: string;
    signal?: AbortSignal;
  } = {},
) {
  const invalidate = capturePeopleWrite(path, options.method);
  try {
    const response = await fetch(path, {
      method: options.method ?? 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      signal: options.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(PEOPLE_LIMITS.requestTimeoutMs)])
        : AbortSignal.timeout(PEOPLE_LIMITS.requestTimeoutMs),
      headers: {
        accept: 'application/json',
        ...(path.split('?')[0] === '/api/people/catalog'
          ? { [PEOPLE_FEATURES_HEADER]: PEOPLE_IMPORT_FEATURE }
          : {}),
        ...(options.body !== undefined
          ? { 'content-type': 'application/json', 'x-csrf-token': options.csrf ?? '' }
          : {}),
        ...(options.key ? { 'idempotency-key': options.key } : {}),
      },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    });
    const reader = response.body?.getReader();
    if (!reader) throw new Error();
    let size = 0;
    const chunks: Uint8Array[] = [];
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.length;
        if (size > PEOPLE_LIMITS.responseBytes) throw new Error();
        chunks.push(next.value);
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!response.ok) {
      const parsed = peopleErrorSchema.safeParse(value);
      if (parsed.success && PEOPLE_ERROR_STATUS[parsed.data.code] === response.status)
        throw new PeopleError(
          response.status,
          parsed.data.code,
          'reason' in parsed.data ? parsed.data.reason : undefined,
        );
      throw new PeopleError(response.status, 'PEOPLE_UNAVAILABLE');
    }
    try {
      const parsed = schema.parse(value);
      invalidate();
      return parsed;
    } catch {
      // A successful HTTP response rejected by the client is not a service outage.
      // Keep mutation outcomes uncertain: it may already have been committed.
      throw new PeopleError(503, 'PEOPLE_RESPONSE_INVALID');
    }
  } catch (error) {
    if (error instanceof PeopleError) throw error;
    throw new PeopleError(503, 'PEOPLE_UNAVAILABLE');
  }
}
export function commandTarget(input: unknown) {
  const command = peopleCommandSchema.parse(input);
  const route = PEOPLE_ROUTES.find((r) => 'operation' in r && r.operation === command.operation);
  if (!route) throw new Error('Unsupported command');
  return {
    command,
    method: route.method,
    path: route.path.replace('{id}', 'id' in command ? command.id : ''),
  };
}
export function execute(input: unknown, confirmation: string | null, key: string, csrf: string) {
  const target = commandTarget(input);
  return request(target.path, peopleCommandResultSchema, {
    method: target.method,
    csrf,
    key,
    body: { command: target.command, confirmation },
  });
}
export function company(session: UserSessionDto, permission: string) {
  return (
    session.access?.grants.some(
      (g) => g.scope.kind === 'company' && g.permissions.includes(permission as never),
    ) ?? false
  );
}
export function canReadUnits(session: UserSessionDto) {
  return (
    session.access?.grants.some((g) =>
      g.permissions.some((p) =>
        [
          'turnstile:configuration:manage',
          'turnstile:units:manage',
          'turnstile:units:read',
        ].includes(p),
      ),
    ) ?? false
  );
}
export function message(error: unknown) {
  if (error instanceof PeopleError && error.code === 'PEOPLE_RESPONSE_INVALID')
    return 'This page could not read the server response. Refresh the page to load the latest version. Copy any unsaved entries before refreshing.';
  if (error instanceof PeopleError && error.code === 'DEPLOYMENT_RESTRICTED')
    return 'This installation is restricted. Existing authorized reads remain available; changes require renewed approval. Your draft is kept.';
  if (!(error instanceof PeopleError)) return 'Check your entries and review this change again.';
  if (error.status === 401)
    return 'Your session ended. Sign in again to continue. Your draft is kept on this page.';
  if (error.status === 403)
    return 'Your current access does not allow this change. Check your session and review the selected permissions and scope.';
  if (error.status === 429) return 'Too many requests. Wait a minute before trying again.';
  if (error.reason === 'readiness')
    return 'Administration changes are not available for this installation yet. Your draft is kept.';
  if (error.reason === 'impact_stale')
    return 'This review expired. Review current impact again before saving. Your draft is kept.';
  if (error.reason === 'reference_in_use')
    return 'This role is still used by saved member assignments or actionable invitations. Remove or replace its member assignments and cancel or reapprove invitations without this role, then review deletion again. Retained invitation history alone does not prevent deletion.';
  if (error.reason === 'duplicate_name')
    return 'A role with this name already exists. Choose a different name.';
  if (error.status === 409)
    return `Saved access has changed${error.reason ? ` (${error.reason.replaceAll('_', ' ')})` : ''}. Reload current data and review a new change. Your draft is kept.`;
  if (error.status === 400) return 'Check the name, permissions, assignments and selected scope.';
  if (error.status === 404)
    return 'This item is no longer available with your current access. Reload current data and compare it with your draft.';
  if (error.status === 413)
    return 'This change is too large. Reduce the assignments or selected units and review again.';
  return 'The service is unavailable. Your draft is kept. Reload current data before trying again.';
}

/** Presentation only; each operation is independently re-authorized by the backend. */
export function canManageUnit(session: UserSessionDto, id: string, ancestors: string[]) {
  return (
    session.access?.grants.some((g) => {
      if (g.scope.kind === 'company')
        return (
          g.permissions.includes('turnstile:configuration:manage') ||
          g.permissions.includes('turnstile:units:manage')
        );
      return (
        g.permissions.includes('turnstile:units:manage') &&
        g.scope.unitIds.some(
          (anchor) =>
            anchor === id ||
            (g.scope.kind === 'units' && g.scope.includeChildren && ancestors.includes(anchor)),
        )
      );
    }) ?? false
  );
}
