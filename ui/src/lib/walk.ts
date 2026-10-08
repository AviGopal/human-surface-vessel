/**
 * Reading a walk without believing it.
 *
 * Two things here are inference rather than contract, and both are labelled as
 * such where they surface:
 *
 *  - STALL DETECTION. Nothing on the wire says "this run is stuck". Elapsed
 *    time cannot say it either — a legitimately long walk is not stalled. So
 *    the surface fingerprints the observable progress of a run and remembers
 *    when that fingerprint last changed. Silence is measured, not assumed.
 *
 *  - SOLICITATIONS. goalWalkState does NOT carry pending solicitations.
 *    `poolEvents` is `{shape, source, at}` and nothing more; the `human_input`
 *    impulse with its `solicitation_id` and `question_markdown` is posted to a
 *    separate sink vessel, not mirrored onto the dispatch record. So the walk
 *    log is the only signal available here, and what is extracted from it is
 *    presented to the reader as a detection, not as the question itself.
 */

import type { GoalWalkState, WalkLogEntry } from "../api/types";
import type { Question } from "../api/participation";

export function walkLogText(entry: WalkLogEntry | null | undefined): string {
  if (entry === null || entry === undefined) return "";
  if (typeof entry === "string") return entry;
  const record = entry as Record<string, unknown>;
  for (const key of ["message", "text", "line", "summary", "step"]) {
    const v = record[key];
    if (typeof v === "string" && v.length > 0) return v;
  }
  try {
    return JSON.stringify(entry);
  } catch {
    return String(entry);
  }
}

/**
 * Everything observable about a run's progress, collapsed to one string.
 * When this stops changing, the run has stopped emitting.
 */
export function progressFingerprint(walk: GoalWalkState): string {
  return [
    walk.status,
    String(walk.reached),
    walk.poolShapes.length,
    walk.poolProvenance.length,
    walk.walkLog.length,
    walk.steps.length,
    walk.attemptCount ?? -1,
    walkLogText(walk.currentStep).slice(0, 120),
  ].join("|");
}

/** The board carries fewer fields, so it fingerprints on the ones it has. */
export function boardFingerprint(row: {
  status: string;
  reached: boolean | null;
  answerBody: string | null;
  executionId?: string;
  selectedTemplateId?: string;
}): string {
  return [
    row.status,
    String(row.reached),
    row.answerBody?.length ?? -1,
    row.executionId ?? "",
    row.selectedTemplateId ?? "",
  ].join("|");
}

export function hasProgress(walk: GoalWalkState): boolean {
  return (
    walk.walkLog.length > 0 ||
    walk.steps.length > 0 ||
    walk.poolShapes.length > 0 ||
    walk.poolProvenance.length > 0
  );
}

/**
 * The question this run has open on this surface: delivered here, linked to the
 * run after the server read the run back, not yet answered or declined, and not
 * past its stored deadline. This is the only source of `waiting`. The walk log
 * is not one: goal-host logs a solicitation only after it has ended.
 *
 * `now` null skips the deadline: an open run view heartbeats the question, so
 * goal-host's deadline moves while the stored one does not.
 */
export function openRunQuestion(
  questions: readonly Question[] | undefined,
  dispatchId: string,
  now: number | null,
): Question | null {
  return (
    questions?.find(
      (q) =>
        q.run?.linked === true &&
        q.run.dispatchId === dispatchId &&
        !q.answered &&
        !q.declined &&
        (now === null || q.run.deadlineAt === null || q.run.deadlineAt > now),
    ) ?? null
  );
}

