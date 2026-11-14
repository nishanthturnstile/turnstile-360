import { useQuery, useQueryClient } from '@tanstack/react-query';
import { scopedUnitsResponseSchema } from '@thaarei/turnstile-contracts';
import { useCallback, useMemo, useState } from 'react';
import { usePeopleActivity } from './activity';
import { PeopleError, request } from './client';
import { usePeopleScope } from './QueryScope';
import { peopleQueryKey, refreshPeopleQuery } from './query-cache';
import { loadScopedHierarchy } from './structure-hierarchy';

export function useHierarchy() {
  const scope = usePeopleScope();
  const active = usePeopleActivity();
  const client = useQueryClient();
  const key = useMemo(
    () => peopleQueryKey(scope, 'hierarchy-v1', '/api/structure/units?limit=100'),
    [scope],
  );
  const generation = JSON.stringify(scope);
  const [progress, setProgress] = useState<{ loaded: number; total: number; generation: string }>();
  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) =>
      loadScopedHierarchy(
        (cursor, signal) =>
          request(
            `/api/structure/units?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
            scopedUnitsResponseSchema,
            { signal },
          ),
        signal,
        (value) => setProgress({ ...value, generation }),
      ),
    enabled: active,
  });
  const denied = query.error instanceof PeopleError && [401, 403].includes(query.error.status);
  const refresh = useCallback(() => {
    void refreshPeopleQuery(client, key);
  }, [client, key]);
  return {
    value: denied ? undefined : query.data,
    failure: query.error,
    loading: query.isPending || query.isFetching,
    refreshing: query.isFetching && query.data !== undefined,
    progress: progress?.generation === generation ? progress : undefined,
    refresh,
  };
}
