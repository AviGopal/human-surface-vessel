/**
 * Rule P7 — grading, and what is deliberately NOT here.
 *
 * There is no agree affordance. No thumbs-up, no "looks right", no star. A
 * correct outcome needs no feedback, and soliciting praise pollutes a corpus
 * that is already a biased failure sample: the verdicts that reach the oracle
 * are overwhelmingly the ones somebody was annoyed enough to file. Adding an
 * easy positive button does not fix that bias, it inverts it.
 *
 * The options are mutually exclusive and collectively exhaustive over the
 * failure space, and they come from VERDICT_OPTIONS in the token package rather
 * than being written inline — one declaration, so the checker can read the set
 * and the surface cannot quietly grow a seventh option.
 *
 * The option set depends on the RENDERED VERDICT: challenging a reach and
 * challenging a non-reach are different acts with different failure spaces.
 */
import { type ReactNode } from "react";
export declare function GradeGesture({ renderedState, executionId, goal, alreadyGraded, humanReachNotes, }: {
    renderedState: "reached" | "not-reached";
    /** ABSENT when goal-host never recorded one — the key is not serialized. */
    executionId: string | undefined;
    goal: string;
    alreadyGraded: boolean;
    humanReachNotes: string | null;
}): ReactNode;
//# sourceMappingURL=GradeGesture.d.ts.map