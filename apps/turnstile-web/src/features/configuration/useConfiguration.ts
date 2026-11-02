import type { ConfigurationSnapshotDto } from '@thaarei/turnstile-contracts';
import { useEffect, useRef, useState } from 'react';
import { loadConfiguration } from './api';
export function useConfiguration() {
  const [snapshot, setSnapshot] = useState<ConfigurationSnapshotDto>();
  const [failure, setFailure] = useState<unknown>();
  const [loading, setLoading] = useState(true);
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
          setSnapshot(value);
          setLoading(false);
        }
      },
      (error) => {
        if (active) {
          setFailure(error);
          setLoading(false);
        }
      },
    );
    return () => {
      active = false;
    };
  }, []);
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
  return { snapshot, setSnapshot, failure, loading, reload, refresh };
}
