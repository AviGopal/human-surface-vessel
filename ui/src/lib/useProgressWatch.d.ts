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
export declare function useProgressWatch(fingerprint: string, now: number): number | null;
//# sourceMappingURL=useProgressWatch.d.ts.map