/**
 * `startedAt` has arrived on the wire as both an ISO string and an epoch
 * number, and as null when the record lost it. Parse defensively: a NaN sort
 * key silently collapses the board's ordering, and NaN compares false against
 * everything, so the failure is invisible.
 */
export declare function parseStartedAt(v: string | number | null | undefined, fallback: number): number;
/** Compact elapsed, for a cell that updates in place without moving its row. */
export declare function formatElapsed(ms: number): string;
export declare function formatDurationBand(lowSec: number, highSec: number): string;
export declare function formatChars(n: number): string;
export declare function formatClock(ms: number): string;
//# sourceMappingURL=time.d.ts.map