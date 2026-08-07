/**
 * Rule P5, in the only place the surface is allowed to order rows.
 *
 * Two properties, both load-bearing:
 *
 * 1. The comparator reads ONLY values that are fixed for the lifetime of a run.
 *    `startedAt` never changes; `dispatchId` never changes. Sorting by status,
 *    by elapsed time, or by reach verdict would reorder the board as work
 *    progresses — which means a row moves out from under a reader at exactly
 *    the moment it becomes worth reading. That is the attested failure this
 *    whole surface was rebuilt to fix.
 *
 * 2. The comparator ENDS in a unique tiebreaker. Two runs accepted in the same
 *    millisecond must still have a total order, or their relative position is
 *    whatever the sort implementation felt like this frame, and they swap on
 *    every poll for no reason at all.
 */

export interface SortableRun {
  readonly dispatchId: string;
  readonly startedAtMs: number;
}

export function compareRuns(a: SortableRun, b: SortableRun): number {
  // Newest first.
  if (a.startedAtMs !== b.startedAtMs) return b.startedAtMs - a.startedAtMs;
  // Unique tiebreaker — every comparator in this surface ends on this line.
  return a.dispatchId < b.dispatchId ? -1 : a.dispatchId > b.dispatchId ? 1 : 0;
}

export function sortRuns<T extends SortableRun>(runs: readonly T[]): readonly T[] {
  return [...runs].sort(compareRuns);
}
