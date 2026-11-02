import type { ConfigurationSnapshotDto } from '@thaarei/turnstile-contracts';
import { useEffect, useRef, useState } from 'react';
import { loadConfiguration } from './api';
export function useConfiguration(reloadKey?: string) {
  const [snapshot, setSnapshot] = useState<ConfigurationSnapshotDto>();
  const [failure, setFailure] = useState<unknown>();
  const [loading, setLoading] = useState(true);
  const [loadedKey, setLoadedKey] = useState(reloadKey);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    void loadConfiguration().then(
      (value) => {
        if (active) {
          setSnapshot((current) =>
            current && current.revision > value.revision ? current : value,
          );
          setLoading(false);
          setLoadedKey(reloadKey);
        }
      },
      (error) => {
        if (active) {
          setFailure(error);
          setLoading(false);
          setLoadedKey(reloadKey);
        }
      },
    );
    return () => {
      active = false;
    };
  }, [reloadKey]);
  async function reload() {
    const value = await loadConfiguration();
    if (alive.current) setSnapshot(value);
    return value;
  }
  async function refresh() {
    setLoading(true);
    try {
      await reload();
      if (alive.current) setFailure(undefined);
    } catch (error) {
      if (alive.current) setFailure(error);
    } finally {
      if (alive.current) setLoading(false);
    }
  }
  return {
    snapshot,
    setSnapshot,
    failure,
    loading: loading || loadedKey !== reloadKey,
    reload,
    refresh,
  };
}
