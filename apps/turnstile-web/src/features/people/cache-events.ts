export type PeopleDomain =
  | 'members'
  | 'roles'
  | 'eligible-roles'
  | 'invitations'
  | 'catalog'
  | 'audit'
  | 'imports'
  | 'structure'
  | 'organization';
type Listener = (domains: readonly PeopleDomain[]) => void;
const listeners = new Set<Listener>();
export function subscribePeopleWrites(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function writeDomains(path: string, method = 'GET'): readonly PeopleDomain[] {
  if (['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase())) return [];
  const pathname = path.split('?')[0] ?? '';
  if (pathname === '/api/people/impact' || pathname === '/api/structure/move-impact') return [];
  if (/^\/api\/people\/imports(?:\/|$)/u.test(pathname)) return ['imports'];
  if (/^\/api\/structure(?:\/|$)/u.test(pathname))
    return [
      'structure',
      'organization',
      'members',
      'roles',
      'eligible-roles',
      'invitations',
      'catalog',
      'audit',
      'imports',
    ];
  if (/^\/api\/people\/(?:members|roles|invitations)(?:\/|$)/u.test(pathname))
    return ['members', 'roles', 'eligible-roles', 'invitations', 'catalog', 'audit', 'imports'];
  return [];
}
/** Capture the original cache owner; a late write acknowledgement cannot touch a new user's cache. */
export function capturePeopleWrite(path: string, method?: string) {
  const domains = writeDomains(path, method);
  const owners = domains.length ? [...listeners] : [];
  return () => {
    for (const notify of owners) notify(domains);
  };
}
