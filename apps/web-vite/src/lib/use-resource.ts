import { useCallback, useEffect, useState } from "react";

interface Resource<T> {
  data: T | undefined;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

export function useResource<T>(loader: () => Promise<T>, dependencies: readonly unknown[]): Resource<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);

  const reload = useCallback(() => setRevision((value) => value + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void loader()
      .then((value) => {
        if (!cancelled) setData(value);
      })
      .catch((unknownError: unknown) => {
        if (!cancelled) setError(unknownError instanceof Error ? unknownError.message : "The request failed.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
    // Loader identity is intentionally excluded; callers supply stable primitive dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...dependencies, revision]);

  return { data, error, loading, reload };
}
