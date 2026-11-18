export type Kept<T> = {
  value: T | null;
  stale: boolean;
  failed: boolean;
};

/** A failed attempt keeps the previous result and marks it stale. */
export function keepLastGood<T>(previous: T | null, attempt: () => T): Kept<T> {
  try {
    return { value: attempt(), stale: false, failed: false };
  } catch {
    return { value: previous, stale: previous != null, failed: true };
  }
}
