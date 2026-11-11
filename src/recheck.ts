/**
 * How often the surface looks again: the live cadence, each reader's floor under it, and how
 * long a cached answer is trusted. A field of the render policy (`recheck`), read at use time
 * by the server and the page alike, so the system can change it by writing the policy and a
 * trace can see the value in force (law 1). The numbers below are the bootstrap defaults.
 *
 * A patch merges key by key: a key it does not name keeps the value in force. Every key is a
 * plain number, so there is no inner map whose keys a merge could fail to remove. A value
 * outside its range is not read, and the write says so.
 *
 * Kept out: the event stream's keepalive (it must stay under the server's idle timeout, a
 * bootstrap value) and credential lifetimes (a typed sentence reaches `renderPolicy_write`,
 * and must not be able to loosen sign-in).
 */

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

/** The guard: the least and most each key may be, in milliseconds. */
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

function inRange(key: RecheckKey, v: unknown): v is number {
  const [lo, hi] = RECHECK_RANGES[key];
  return typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;
}

/**
 * The keys of a `recheck` patch this guard reads. Each refused key or value is named in
 * `rejected`; undefined when the patch carries nothing to read.
 */
export function recheckPatch(raw: unknown, rejected: string[]): Partial<Recheck> | undefined {
  if (raw === undefined) return undefined;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    rejected.push("recheck must be an object of millisecond values");
    return undefined;
  }
  const out: Partial<Record<RecheckKey, number>> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!(RECHECK_KEYS as readonly string[]).includes(k)) {
      rejected.push(`recheck.${k} is not read; the keys are ${RECHECK_KEYS.join(", ")}`);
      continue;
    }
    const key = k as RecheckKey;
    if (!inRange(key, v)) {
      const [lo, hi] = RECHECK_RANGES[key];
      rejected.push(`recheck.${key} must be an integer from ${lo} to ${hi}`);
      continue;
    }
    out[key] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** A whole recheck from whatever was stored or served: each missing or junk key is its default. */
export function recheckOf(raw: unknown): Recheck {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return Object.fromEntries(RECHECK_KEYS.map((k) => [k, inRange(k, r[k]) ? r[k] : DEFAULT_RECHECK[k]])) as Recheck;
}
