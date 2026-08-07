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

import { isTerminal, type RunState } from "@avigopal/design-tokens";
import type { DispatchStatus } from "../api/types";

/**
 * How long a run may go without its progress fingerprint changing before the
 * surface stops claiming it is working.
 */
export const STALL_AFTER_MS = 90_000;

export interface RunFacts {
  readonly status: DispatchStatus;
  readonly reached: boolean | null;
  /** The walk is blocked on a human answer. */
  readonly awaitingAnswer: boolean;
  /** Any evidence at all that the walk has done something. */
  readonly hasProgress: boolean;
  /** ms since the progress fingerprint last changed, or null if never seen. */
  readonly quietForMs: number | null;
}

export function deriveRunState(f: RunFacts): RunState {
  // Terminal first. Both `completed` and `failed` are terminal, and neither of
  // them is the verdict.
  if (f.status === "completed" || f.status === "failed") {
    return f.reached === true ? "reached" : "not-reached";
  }
  if (f.awaitingAnswer) return "waiting";
  if (f.quietForMs !== null && f.quietForMs > STALL_AFTER_MS) return "stalled";
  // A dispatch id and nothing else. `ageMs` is deliberately NOT consulted here:
  // a run that has emitted nothing is `accepted` whether it is one second old
  // or thirty, and only sustained silence (above) promotes that to `stalled`.
  if (!f.hasProgress) return "accepted";
  return "running";
}

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
export function verdictSentence(args: {
  state: RunState;
  status: DispatchStatus;
  reached: boolean | null;
  goalReachReason: string | null;
  error?: string;
  humanGraded: boolean;
}): string {
  const reason = args.goalReachReason?.trim();
  if (args.state === "reached") {
    const base = reason || "the goal's target shapes were covered.";
    return args.status === "failed"
      ? `Reached, though the template itself exited failed — ${base}`
      : base;
  }
  if (args.state === "not-reached") {
    if (args.reached === null) {
      return reason
        ? `Finished without a reach verdict — no evidence the goal was met. ${reason}`
        : "Finished without a reach verdict. Nothing here shows the goal was met — the run was never graded, which is not the same as succeeding.";
    }
    if (args.status === "completed") {
      return reason
        ? `Not reached. The template exited cleanly and the goal was still not met — ${reason}`
        : "Not reached. The template exited cleanly and the goal was still not met.";
    }
    return reason || args.error || "Not reached, and the walk did not record a reason.";
  }
  if (args.state === "waiting") return "Blocked on a human answer. Nothing advances until the question is answered.";
  if (args.state === "stalled")
    return "Accepted, then silent. Nothing has changed for over a minute and a half — this is a liveness failure, not a verdict.";
  if (args.state === "accepted")
    return "Accepted. A dispatch id exists and nothing else does yet — the walk was received, which is not the same as started.";
  return reason || "In flight.";
}

/** What a reader can do next. Part four of the detail panel. */
export function whatHappensNext(state: RunState, canInject: boolean): string {
  switch (state) {
    case "reached":
      // "above", not "below": WHAT HAPPENS NEXT is part four and renders
      // AFTER the evidence ledger.
      return "Done. If the evidence above does not match what you asked for, grade it — that is the only signal that corrects the posterior.";
    case "not-reached":
      return "Nothing further will happen on its own. Grade it if the verdict is wrong, or re-ask with the missing information — a wrong output is usually a fact that was not available at the moment it was needed.";
    case "waiting":
      return "Answer the question and the walk resumes where it stopped.";
    case "stalled":
      return canInject
        ? "The walk still holds its pool. Injecting context is the salvage path — it is cheaper than re-dispatching from nothing."
        : "The walk is no longer accepting context. Re-ask, carrying whatever it was missing.";
    case "accepted":
      return "Waiting for the walk to emit its first step.";
    case "running":
      return canInject
        ? "In flight. Context can still be pushed into the pool while it runs."
        : "In flight.";
    default:
      return "";
  }
}

export function stateIsTerminal(state: RunState): boolean {
  return isTerminal(state);
}
