/**
 * How often the surface looks again: the live cadence, each reader's floor under it, and how
 * long a cached answer is trusted. A field of the render policy (`recheck`), read at use time
 * by the server and the page alike, so the system can change it by writing the policy and a
 * trace can see the value in force (law 1). The numbers below are the bootstrap defaults.
 *
 * Read and merged as every bounded group is (src/bounded-group.ts).
 *
 * Kept out: the event stream's keepalive (it must stay under the server's idle timeout, a
 * bootstrap value) and credential lifetimes (a typed sentence reaches `renderPolicy_write`,
 * and must not be able to loosen sign-in).
 */
import { boundedGroup } from "./bounded-group.ts";

export const RECHECK_KEYS = [
  /** The page's live cadence until the person picks one. */
  "liveMs",
  /** The safety cadence while store events are arriving. */
  "streamFallbackMs",
  /** No report is read more often than this: each read costs its producer. */
  "reportMinMs",
  /** No view is re-read more often than this. */
  "viewMinMs",
  /** The Issues drawer's floor. */
  "issuesMinMs",
  /** The questions list's floor. */
  "questionsMinMs",
  /** How often the page asks whether the person is still signed in. */
  "sessionMs",
  /** How long a question's gap status is trusted before it is read again. */
  "gapStatusTtlMs",
  /** How long a page frame is kept for its reader. */
  "frameTtlMs",
] as const;

export type RecheckKey = (typeof RECHECK_KEYS)[number];
export type Recheck = Readonly<Record<RecheckKey, number>>;

export const DEFAULT_RECHECK: Recheck = {
  liveMs: 2_000,
  streamFallbackMs: 60_000,
  reportMinMs: 60_000,
  viewMinMs: 5_000,
  issuesMinMs: 15_000,
  questionsMinMs: 5_000,
  sessionMs: 60_000,
  gapStatusTtlMs: 600_000,
  frameTtlMs: 1_800_000,
};

/**
 * The guard: the least and most each key may be, in milliseconds.
 *
 * Debts, named: these bounds are the guard's own numbers. A reader's floor exists because each
 * read costs its producer, so its right source is the producer's own advertised cost or rate,
 * read through discovery, not a surface constant. And no learning activity writes `recheck`
 * yet: it is shaped, but unlearned.
 */
export const RECHECK_RANGES: Readonly<Record<RecheckKey, readonly [number, number]>> = {
  liveMs: [500, 600_000],
  streamFallbackMs: [5_000, 3_600_000],
  reportMinMs: [5_000, 3_600_000],
  viewMinMs: [1_000, 600_000],
  issuesMinMs: [1_000, 600_000],
  questionsMinMs: [1_000, 600_000],
  sessionMs: [5_000, 3_600_000],
  gapStatusTtlMs: [10_000, 86_400_000],
  frameTtlMs: [60_000, 86_400_000],
};

export const RECHECK = boundedGroup("recheck", DEFAULT_RECHECK, RECHECK_RANGES);

/** The keys of a `recheck` patch this guard reads; each refused one is named in `rejected`. */
export const recheckPatch = (raw: unknown, rejected: string[]): Partial<Recheck> | undefined => RECHECK.patch(raw, rejected);

/** A whole recheck from whatever was stored or served: each missing or junk key is its default. */
export const recheckOf = (raw: unknown): Recheck => RECHECK.of(raw);
