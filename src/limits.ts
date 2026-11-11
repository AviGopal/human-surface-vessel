/**
 * How much the surface draws, and how much it asks of a producer at once: a field of the
 * render policy (`limits`), read at use time by the server and the page alike (law 1). The
 * numbers below are the bootstrap defaults; the group is read and merged as every bounded
 * group is (src/bounded-group.ts).
 *
 * Kept out, and why: the bounds on what a write may contain or the surface may hold are the
 * guard's (a policy any node-key caller writes must not be able to raise them); the in-memory
 * history ring goes with the surface-kept state it bounds (3.4); and the form planner's scalar
 * threshold is a form decision, which moves to an activity with the form learner (3.2).
 */
import { boundedGroup } from "./bounded-group.ts";

export const DEFAULT_LIMITS = {
  /** Lines the box grows to before it scrolls. */
  boxLines: 8,
  /** How deep a record nests before it is summarised. */
  recordMaxDepth: 4,
  /** Plain values a `fields` entry shows before "and N more". */
  fieldsShown: 8,
  /** Items of a list named under it. */
  itemsNamed: 3,
  /** Characters of a table cell's tooltip: a hint, not a second content pane. */
  cellTitleChars: 2_000,
  /** Gap-status reads in flight at once. */
  gapStatusConcurrency: 4,
  /** Gap statuses read for one questions read. */
  gapStatusPerRead: 60,
} as const;

export type LimitKey = keyof typeof DEFAULT_LIMITS;
export type Limits = Readonly<Record<LimitKey, number>>;

/**
 * The guard. Debts, as for recheck: these bounds are the guard's own numbers; the gap-status
 * load belongs to the gap producer's own advertised rate, read through discovery (its
 * concurrency is held low for that reason); and no learning activity writes `limits` yet.
 */
export const LIMIT_RANGES: Readonly<Record<LimitKey, readonly [number, number]>> = {
  boxLines: [2, 40],
  recordMaxDepth: [1, 12],
  fieldsShown: [1, 100],
  itemsNamed: [0, 50],
  cellTitleChars: [100, 20_000],
  gapStatusConcurrency: [1, 8],
  gapStatusPerRead: [1, 500],
};

export const LIMITS = boundedGroup<LimitKey>("limits", DEFAULT_LIMITS, LIMIT_RANGES);
