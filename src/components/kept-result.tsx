"use client";

import { useMemo, useRef, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { keepLastGood } from "@/lib/keep-last";

export function useKeptResult<T>(compute: () => T, deps: readonly unknown[]) {
  const last = useRef<T | null>(null);
  const [tick, setTick] = useState(0);
  const result = useMemo(
    () => {
      const settled = keepLastGood(last.current, compute);
      last.current = settled.failed ? last.current : settled.value;
      return settled;
    },
    // `compute` closes over the inputs listed by the caller.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tick, ...deps],
  );
  return {
    value: result.value,
    stale: result.stale,
    failed: result.failed,
    retry: () => setTick((count) => count + 1),
  };
}

export function StaleNotice({
  failed,
  stale,
  onRetry,
}: {
  failed: boolean;
  stale: boolean;
  onRetry: () => void;
}) {
  if (!failed) return null;
  return (
    <Alert data-testid="stale-result">
      <AlertTitle>{stale ? "Stale" : "Couldn't calculate"}</AlertTitle>
      <AlertDescription className="flex flex-wrap items-center gap-3">
        <span>{stale ? "Showing the last good result." : "Nothing to show yet."}</span>
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          Retry
        </Button>
      </AlertDescription>
    </Alert>
  );
}
