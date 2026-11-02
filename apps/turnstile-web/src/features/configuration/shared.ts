import type {
  ConfigurationErrorDto,
  ConfigurationSnapshotDto,
  UserSessionDto,
} from '@thaarei/turnstile-contracts';
import { useEffect, useRef } from 'react';
import { ProductError } from '../auth/product';
export function notice(error: unknown) {
  if (!(error instanceof ProductError))
    return 'We couldn’t load saved setup. Your entries are still here. Try again.';
  if (error.detail?.code === 'CONFIGURATION_CONFLICT' && error.detail.reason === 'duplicate_name')
    return 'A unit with this name already exists under this parent. Choose a different name.';
  if (error.detail?.code === 'CONFIGURATION_CONFLICT' && error.detail.reason === 'unit_in_use')
    return 'This unit is in use and cannot be removed. Load the latest saved structure.';
  if (error.code === 'CONFIGURATION_NOT_FOUND')
    return 'This unit no longer exists. Load the latest saved structure.';
  if (error.code === 'CONFIGURATION_CONFLICT')
    return 'Saved setup has changed. Load the latest saved data and compare it with your entries before trying again.';
  if (error.code === 'CONFIGURATION_INVALID') return 'Check the highlighted fields and try again.';
  if (error.code === 'CSRF_REJECTED')
    return 'Your session changed. Refresh your session, then deliberately try again. Your entries are kept.';
  if (error.code === 'CONFIGURATION_TOO_LARGE')
    return 'This change is too large. Shorten your entries and try again.';
  if (error.status === 401) return 'Your session has ended. Sign in again to continue.';
  if (error.status === 403)
    return 'You no longer have permission to manage configuration. Check your access or sign out.';
  return 'We couldn’t confirm this change. Your entries are kept. Load saved data before trying again.';
}
export function fieldError(error: ConfigurationErrorDto | undefined, field: string) {
  if (
    error?.code === 'CONFIGURATION_CONFLICT' &&
    error.reason === 'duplicate_name' &&
    field === 'name'
  )
    return 'A unit with this name already exists under this parent.';
  if (
    error?.code !== 'CONFIGURATION_INVALID' ||
    !error.fieldErrors.some((item) => item.field === field)
  )
    return undefined;
  return field === 'timeZone'
    ? 'Choose a supported time zone.'
    : field === 'name'
      ? 'Enter a valid name within the displayed limit.'
      : 'Choose a supported parent for this unit.';
}
export function clearFieldError(error: ConfigurationErrorDto | undefined, field: string) {
  if (error?.code === 'CONFIGURATION_INVALID') {
    const fieldErrors = error.fieldErrors.filter((item) => item.field !== field);
    return fieldErrors.length ? { ...error, fieldErrors } : undefined;
  }
  if (
    error?.code === 'CONFIGURATION_CONFLICT' &&
    error.reason === 'duplicate_name' &&
    field === 'name'
  )
    return undefined;
  return error;
}
export function errorDetail(error: unknown) {
  return error instanceof ProductError ? error.detail : undefined;
}
export function needsSession(error: unknown) {
  return error instanceof ProductError && (error.status === 401 || error.status === 403);
}

export type EditorProps = {
  snapshot: ConfigurationSnapshotDto;
  session: UserSessionDto;
  reload: () => Promise<ConfigurationSnapshotDto>;
  onSnapshot: (value: ConfigurationSnapshotDto) => void;
  onCheck: () => void;
};
export function useMounted() {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return mounted;
}
const discardChecks = new WeakSet<Event>();
export function useUnsavedEntries(changed: boolean) {
  useEffect(() => {
    if (!changed) return;
    const leave = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        discardChecks.has(event) ||
        event.button !== 0 ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (
        !(link instanceof HTMLAnchorElement) ||
        link.target === '_blank' ||
        link.hasAttribute('download')
      )
        return;
      discardChecks.add(event);
      if (
        !window.confirm(
          'Leave this step and discard unsaved entries? Your saved progress will remain.',
        )
      )
        event.preventDefault();
    };
    document.addEventListener('click', leave);
    return () => document.removeEventListener('click', leave);
  }, [changed]);
}
