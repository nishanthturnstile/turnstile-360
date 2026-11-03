import {
  createContext,
  type ReactNode,
  type RefObject,
  useCallback,
  useContext,
  useEffect,
  useRef,
} from 'react';
import { Link, type LinkProps, useBlocker } from 'react-router';

const discardMessage =
  'Leave this step and discard unsaved entries? Your saved progress will remain.';
const DirtyEntries = createContext<(entry: RefObject<boolean>) => () => void>(() => () => {});

/** One blocker aggregates all editors, including a structure form and an open unit editor. */
export function NavigationGuard({ children }: { children: ReactNode }) {
  const entries = useRef(new Set<RefObject<boolean>>());
  const register = useCallback((entry: RefObject<boolean>) => {
    entries.current.add(entry);
    return () => {
      entries.current.delete(entry);
    };
  }, []);
  const dirty = useCallback(() => [...entries.current].some((entry) => entry.current), []);
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      currentLocation.pathname !== nextLocation.pathname && dirty(),
  );
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    if (window.confirm(discardMessage)) blocker.proceed();
    else blocker.reset();
  }, [blocker]);
  return <DirtyEntries value={register}>{children}</DirtyEntries>;
}

export function useNavigationEntries(changed: boolean) {
  const register = useContext(DirtyEntries);
  const entry = useRef(changed);
  entry.current = changed;
  useEffect(() => register(entry), [register]);
  // Successful saves may navigate before React commits the returned canonical snapshot.
  return () => {
    entry.current = false;
  };
}

/** Auth/identity endpoints and external URLs keep full browser navigation. */
export function AppLink({ href, ...props }: Omit<LinkProps, 'to'> & { href: string }) {
  const internal = href.startsWith('/') && !href.startsWith('//');
  const documentRoute = /^\/(api|identity)(\/|\?|#|$)/.test(href);
  return <Link to={href} reloadDocument={!internal || documentRoute} {...props} />;
}
