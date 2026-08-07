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

const SOLICITATION_MARKER = /(solicit|awaiting (a )?(human|your) (answer|input)|human_input|asked you)/i;
const SOLICITATION_ID = /\b(sol[-_][A-Za-z0-9-]{4,}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/;

export interface DetectedSolicitation {
  /** null when the log names a question but not its id — say so, do not guess. */
  readonly solicitationId: string | null;
  /** The log line the detection came from. Shown verbatim; it is the only text there is. */
  readonly evidenceLine: string;
}

export function detectSolicitation(walk: GoalWalkState): DetectedSolicitation | null {
  if (walk.status !== "running") return null;
  const lines = [...walk.walkLog].map(walkLogText).reverse();
  const current = walkLogText(walk.currentStep);
  if (current) lines.unshift(current);
  for (const line of lines) {
    if (!SOLICITATION_MARKER.test(line)) continue;
    const match = SOLICITATION_ID.exec(line);
    return { solicitationId: match?.[0] ?? null, evidenceLine: line };
  }
  return null;
}

/**
 * Counterfactual explanation, offered on failure only.
 *
 * Explanation sprayed across successes manufactures over-reliance; offered
 * after an acknowledged failure it demonstrably repairs trust. And it takes
 * counterfactual form — which path, over which other one, and on what evidence
 * — rather than a number.
 */
export function pathExplanation(walk: GoalWalkState): string | null {
  if (!walk.executionPath) return null;
  const attempts = walk.attemptCount;
  const template = walk.selectedTemplateId;
  const parts: string[] = [];
  if (template) parts.push(`it chose template ${template}`);
  if (typeof attempts === "number" && attempts > 1) parts.push(`after ${attempts} attempts`);
  if (walk.grounded === false) parts.push("and it was not grounded in anything it read");
  if (walk.grounded === true) parts.push("grounded in what it read");
  return parts.length > 0 ? parts.join(", ") : null;
}
