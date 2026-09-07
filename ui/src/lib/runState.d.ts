/**
 * The verdict derivation. This is rule P1 in one place.
 *
 * `status` is the template's exit status and nothing more. A walk that exits
 * `completed` while never meeting its goal is the measured, dominant failure of
 * this system — so `status` is never the thing a reader scans, and this module
 * is the only place in the surface that reads it. It is read here ALWAYS
 * alongside `reached`, and what leaves this module is a verdict, not a status.
 *
 * Rule P10 also lives here: `accepted` and `stalled` are real states.
 * A dispatch id means the walk was RECEIVED. It does not mean anything
 * happened. And a run that was accepted and then went silent is a liveness
 * failure — rendering it as `running` shows a spinner over work that died.
 */
import { type RunState } from "@avigopal/design-tokens";
import type { DispatchStatus } from "../api/types";
/**
 * How long a run may go without its progress fingerprint changing before the
 * surface stops claiming it is working.
 */
export declare const STALL_AFTER_MS = 90000;
/**
 * How long a run may sit having produced NOTHING before the board stops calling
 * it merely accepted.
 *
 * Deliberately far longer than STALL_AFTER_MS. That one watches a run that has
 * already shown it is alive and then went quiet, which is strong evidence. This
 * one watches a run that has never shown anything, where the honest competing
 * explanation is a busy dispatcher rather than a dead walk — so it waits long
 * enough that queueing is no longer the likely story.
 */
export declare const SILENT_ACCEPT_STALL_MS = 300000;
export interface RunFacts {
    readonly status: DispatchStatus;
    readonly reached: boolean | null;
    /** The walk is blocked on a human answer. */
    readonly awaitingAnswer: boolean;
    /** Any evidence at all that the walk has done something. */
    readonly hasProgress: boolean;
    /** ms since the progress fingerprint last changed, or null if never seen. */
    readonly quietForMs: number | null;
    /**
     * ms since the SERVER accepted this dispatch, from `startedAt` on the wire.
     *
     * `quietForMs` is measured from first observation IN THIS BROWSER SESSION, so
     * it cannot see silence that predates the page load: a run queued for twenty
     * minutes reads as freshly accepted the moment somebody opens the board.
     * `startedAt` is absolute and already on every dispatch record, so a run that
     * has produced nothing at all can be judged against when it was actually
     * received rather than against when this tab happened to notice it.
     */
    readonly acceptedForMs: number | null;
}
export declare function deriveRunState(f: RunFacts): RunState;
/**
 * One honest sentence about what happened.
 *
 * The three cases that matter:
 *  - hollow completion: the template exited cleanly and the goal was not met.
 *    Reported as not reached, at failure weight, with the reason.
 *  - no verdict at all: a terminal run whose `reached` is null was never
 *    graded. Rendering that as anything success-adjacent is the exact sin P1
 *    exists to prevent, so it reads as not reached and the sentence carries the
 *    nuance.
 *  - satisfier reaches: `failed` + `reached: true` is common and IS a reach.
 */
export declare function verdictSentence(args: {
    state: RunState;
    status: DispatchStatus;
    reached: boolean | null;
    goalReachReason: string | null;
    error?: string;
    humanGraded: boolean;
    /** Distinguishes "worked then stopped" from "never started". */
    everProgressed?: boolean;
}): string;
/** What a reader can do next. Part four of the detail panel. */
export declare function whatHappensNext(state: RunState, canInject: boolean): string;
export declare function stateIsTerminal(state: RunState): boolean;
//# sourceMappingURL=runState.d.ts.map