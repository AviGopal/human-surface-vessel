import { useEffect, useRef } from "react";

/**
 * Measure silence.
 *
 * Nothing on the wire says "this run is stuck", and elapsed time cannot say it
 * either — a legitimately long walk is not stalled, and a short one that died
 * ten seconds in is. What distinguishes them is whether anything OBSERVABLE
 * about the run has changed, so this remembers when the caller's fingerprint
 * last differed and reports how long ago that was.
 *
 * Returns null until a change has been observed at least once, so a run that
 * has only just been accepted is not immediately accused of stalling.
 */
export function useProgressWatch(fingerprint: string, now: number): number | null {
  const last = useRef<{ fingerprint: string; at: number } | null>(null);

  useEffect(() => {
    if (last.current === null || last.current.fingerprint !== fingerprint) {
      last.current = { fingerprint, at: Date.now() };
    }
  }, [fingerprint]);

  if (last.current === null) return null;
  if (last.current.fingerprint !== fingerprint) return 0;
  return Math.max(0, now - last.current.at);
}
