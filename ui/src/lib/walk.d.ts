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
export declare function walkLogText(entry: WalkLogEntry | null | undefined): string;
/**
 * Everything observable about a run's progress, collapsed to one string.
 * When this stops changing, the run has stopped emitting.
 */
export declare function progressFingerprint(walk: GoalWalkState): string;
/** The board carries fewer fields, so it fingerprints on the ones it has. */
export declare function boardFingerprint(row: {
    status: string;
    reached: boolean | null;
    answerBody: string | null;
    executionId?: string;
    selectedTemplateId?: string;
}): string;
export declare function hasProgress(walk: GoalWalkState): boolean;
export interface DetectedSolicitation {
    /** null when the log names a question but not its id — say so, do not guess. */
    readonly solicitationId: string | null;
    /** The log line the detection came from. Shown verbatim; it is the only text there is. */
    readonly evidenceLine: string;
}
export declare function detectSolicitation(walk: GoalWalkState): DetectedSolicitation | null;
/**
 * Counterfactual explanation, offered on failure only.
 *
 * Explanation sprayed across successes manufactures over-reliance; offered
 * after an acknowledged failure it demonstrably repairs trust. And it takes
 * counterfactual form — which path, over which other one, and on what evidence
 * — rather than a number.
 */
export declare function pathExplanation(walk: GoalWalkState): string | null;
//# sourceMappingURL=walk.d.ts.map