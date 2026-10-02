/**
 * A dispatch can walk more than once — a feedback retry, a re-frame to
 * alternative targets, a fallback — and each walk replaces `steps` and
 * `poolProvenance` on the dispatch record. `poolEvents` alone accumulates
 * across walks (capped at the last 64), and every walk opens by seeding its
 * variables: the `goal` impulse, then `seed var …` impulses. That seed burst is
 * the attempt boundary.
 *
 * Content for an earlier attempt is therefore gone from the server once the
 * next attempt mirrors. This module keeps what this browser SAW of each
 * attempt, keyed by the attempt's start time, so a reader watching a run does
 * not lose the previous attempt's evidence the moment the next one begins.
 */

import type { GoalWalkState, PoolEvent, RawProvenance, WalkLogEntry, WalkStep } from "../api/types";

export interface AttemptSegment {
  /** 1-based, in time order. */
  readonly number: number;
  /** Time of the attempt's first event; null when unknown. */
  readonly startAt: number | null;
  readonly events: readonly PoolEvent[];
  readonly steps: readonly WalkStep[];
  /** Null when this browser never saw the attempt's content. */
  readonly provenance: readonly RawProvenance[] | null;
  /** Why this attempt began, from the walk log, when it says. */
  readonly reason: string | null;
  readonly current: boolean;
  /** The event cap cut this attempt's opening; what shows is its tail. */
  readonly partial: boolean;
  /** The judge's rejection of this attempt, from its `HOLLOW — …` walk-log line; null when none survives. */
  readonly verdict: string | null;
  /**
   * This attempt is the one the dispatch REPORTS (its verdict reason is the
   * run's `goalReachReason`). Not necessarily the last attempt: a retry that
   * does not reach replaces the reported walk, a re-frame that does not reach
   * does not — so the reported walk can be a middle one.
   */
  readonly reported: boolean;
}

interface Seen {
  provenance: RawProvenance[];
  steps: WalkStep[];
}

const STORE_PREFIX = "sf.attempts.";
const memory = new Map<string, Map<number, Seen>>();

function load(dispatchId: string): Map<number, Seen> {
  const cached = memory.get(dispatchId);
  if (cached) return cached;
  const map = new Map<number, Seen>();
  try {
    const raw = window.sessionStorage.getItem(STORE_PREFIX + dispatchId);
    if (raw) for (const [k, v] of JSON.parse(raw) as [number, Seen][]) map.set(k, v);
  } catch {
    // Unreadable storage is an empty history, not a failure.
  }
  memory.set(dispatchId, map);
  return map;
}

function save(dispatchId: string, map: Map<number, Seen>): void {
  try {
    window.sessionStorage.setItem(STORE_PREFIX + dispatchId, JSON.stringify([...map.entries()]));
  } catch {
    // Quota or privacy mode: the in-memory copy still serves this page.
  }
}

function isSeed(event: PoolEvent): boolean {
  return typeof event.source === "string" && event.source.startsWith("seed var ");
}

/** Indices where a new walk begins: a `goal` impulse opening a seed burst. */
function boundaries(events: readonly PoolEvent[]): number[] {
  const starts: number[] = [];
  events.forEach((event, i) => {
    if (event.shape !== "goal" || isSeed(event)) return;
    const next = events[i + 1];
    if (i === 0 || (next && isSeed(next))) starts.push(i);
  });
  if (starts[0] !== 0) starts.unshift(0);
  return starts;
}

const RESTART_PATTERNS: readonly [RegExp, string][] = [
  [/FEEDBACK-RETRY/, "retried with the prior verdict"],
  [/re-framing to alternative target shapes (\[[^\]]*\])?/, "re-framed to alternative targets"],
  [/fallback walk|FALLBACK/i, "fell back"],
];

function restartReasons(log: readonly WalkLogEntry[]): string[] {
  const reasons: string[] = [];
  for (const entry of log) {
    const text = typeof entry === "string" ? entry : JSON.stringify(entry);
    for (const [pattern, label] of RESTART_PATTERNS) {
      const m = pattern.exec(text);
      if (m) {
        reasons.push(m[1] ? `${label} ${m[1]}` : label);
        break;
      }
    }
  }
  return reasons;
}

const HOLLOW_LINE = /HOLLOW \u2014 (.+?)(?:; \u03b2|$)/;

/** One judge rejection per judged walk, in walk order. */
function hollowVerdicts(log: readonly WalkLogEntry[]): string[] {
  const out: string[] = [];
  for (const entry of log) {
    const text = typeof entry === "string" ? entry : JSON.stringify(entry);
    const m = HOLLOW_LINE.exec(text);
    if (m && m[1]) out.push(m[1].trim());
  }
  return out;
}

function norm(s: string): string {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

function sameProvenance(a: readonly RawProvenance[], b: readonly RawProvenance[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Split a walk state into attempts, recording what is visible now for the
 * current attempt so it survives the next one.
 */
export function segmentAttempts(walk: GoalWalkState): readonly AttemptSegment[] {
  const events = walk.poolEvents;
  const starts = events.length > 0 ? boundaries(events) : [0];
  const startAts = starts.map((i) => (typeof events[i]?.at === "number" ? (events[i]?.at as number) : null));
  const currentStart = startAts[startAts.length - 1] ?? null;

  const seen = load(walk.dispatchId);
  // A snapshot can carry the new walk's seed events before that walk has
  // mirrored its own provenance; content identical to an earlier attempt's is
  // that earlier attempt's, and must not be filed or shown under the new one.
  const stale =
    currentStart !== null &&
    [...seen.entries()].some(
      ([k, v]) => k < currentStart && v.provenance.length > 0 && sameProvenance(v.provenance, walk.poolProvenance),
    );
  if (currentStart !== null) {
    const steps = walk.steps.filter((s) => typeof s["at"] !== "number" || (s["at"] as number) >= currentStart);
    const prev = seen.get(currentStart);
    const provenance = stale ? (prev?.provenance ?? []) : [...walk.poolProvenance];
    if (!prev || !sameProvenance(prev.provenance, provenance) || prev.steps.length !== steps.length) {
      seen.set(currentStart, { provenance, steps });
      save(walk.dispatchId, seen);
    }
  }

  const reasons = restartReasons(walk.walkLog);
  const verdicts = hollowVerdicts(walk.walkLog);
  // The log is a tail: align verdicts to the LAST attempts.
  const verdictOffset = starts.length - verdicts.length;
  const reportedReason = walk.goalReachReason ? norm(walk.goalReachReason) : null;
  // The log is a tail: align reasons to the LAST attempts, since the earliest
  // lines are the ones that fall off.
  const reasonOffset = starts.length - 1 - reasons.length;

  const segs: AttemptSegment[] = starts.map((start, n) => {
    const end = starts[n + 1] ?? events.length;
    const startAt = startAts[n] ?? null;
    const nextAt = startAts[n + 1] ?? null;
    const current = n === starts.length - 1;
    const record = startAt !== null ? seen.get(startAt) : undefined;
    const steps = current
      ? walk.steps.filter((s) => startAt === null || typeof s["at"] !== "number" || (s["at"] as number) >= startAt)
      : (record?.steps ?? []).filter((s) => nextAt === null || typeof s["at"] !== "number" || (s["at"] as number) < nextAt);
    const provenance = current ? (stale ? [] : walk.poolProvenance) : (record?.provenance ?? null);
    const reasonIndex = n - 1 - reasonOffset;
    const verdict = n - verdictOffset >= 0 ? (verdicts[n - verdictOffset] ?? null) : null;
    return {
      number: n + 1,
      startAt,
      events: events.slice(start, end),
      steps,
      provenance,
      reason: n > 0 && reasonIndex >= 0 ? (reasons[reasonIndex] ?? null) : null,
      current,
      partial: n === 0 && events.length >= 64 && events[0]?.shape !== "goal",
      verdict,
      reported: false,
    };
  });

  // Which attempt the dispatch reports: the LAST attempt whose rejection is the
  // run's reason. A reached run reports its last attempt.
  let reportedIndex = -1;
  if (walk.reached === true) reportedIndex = segs.length - 1;
  else if (reportedReason) {
    for (let i = segs.length - 1; i >= 0; i--) {
      const v = segs[i]?.verdict;
      if (v && (norm(v) === reportedReason || reportedReason.startsWith(norm(v)) || norm(v).startsWith(reportedReason))) {
        reportedIndex = i;
        break;
      }
    }
  }
  return reportedIndex < 0 ? segs : segs.map((s, i) => (i === reportedIndex ? { ...s, reported: true } : s));
}
