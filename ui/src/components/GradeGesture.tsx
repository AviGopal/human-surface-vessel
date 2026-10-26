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

import { VERDICT_OPTIONS } from "@avigopal/design-tokens";
import type { ReactNode } from "react";
import { useVerdicts } from "../api/queries";
import type { KeptVerdict } from "../api/types";
import { fillBox } from "../lib/box";

export function GradeGesture({
  renderedState,
  executionId,
  goal,
  alreadyGraded,
  humanReachNotes,
  appliesTo = null,
  changedSomething = false,
  dispatchId = null,
  judgeReached = null,
  about = null,
}: {
  /** The result shown as the answer and its provenance, carried with the grade. */
  about?: Readonly<Record<string, string>> | null;
  /** The run, so a verdict is kept on it as an observation whatever the corpus does. */
  dispatchId?: string | null;
  /** What the judge said, shown beside the person's verdict. */
  judgeReached?: boolean | null;
  renderedState: "reached" | "not-reached" | "ungraded";
  /** ABSENT when goal-host never recorded one — the key is not serialized. */
  executionId: string | undefined;
  goal: string;
  alreadyGraded: boolean;
  humanReachNotes: string | null;
  /** The run made a change (a code edit), so a reached verdict is about the change, not an answer. */
  changedSomething?: boolean;
  /** Which attempt a grade lands on, when the run walked more than once. */
  appliesTo?: string | null;
}): ReactNode {
  const options = VERDICT_OPTIONS[renderedState === "reached" && !changedSomething ? "reached-answer" : renderedState];
  const kept = useVerdicts(dispatchId).data ?? [];

  if (alreadyGraded) {
    return (
      <div className="sf-grade">
        <p className="sf-note">Graded{humanReachNotes ? `: “${humanReachNotes}”` : ""}</p>
      </div>
    );
  }

  // The write is keyed on execution id, and that key is one of the fields
  // goal-host serializes without a null coalesce — so it is ABSENT, not null,
  // when it was never recorded. Offering a verdict that cannot land would be a
  // reading with no reader.
  if (!executionId) {
    return (
      <div className="sf-grade">
        <p className="sf-note sf-muted">No execution id — cannot be graded</p>
      </div>
    );
  }

  // One input (16f): the form retired with sign-in. Its reasons are phrases the box
  // reads as verdicts; these chips put one in the box, and never send. A note follows
  // a colon ("wrong answer: Barcelona isn't in Italy"). The box keeps the verdict on
  // the run and records it as the person's when they are signed in.
  void goal;
  void about;
  return (
    <>
      {kept.length > 0 ? <KeptVerdicts kept={kept} judgeReached={judgeReached} /> : null}
      <div className="sf-grade sf-verdict-chips" aria-label={renderedState === "ungraded" ? "Your verdict" : "Disagree with the verdict?"}>
        {appliesTo ? <p className="sf-note sf-muted sf-grade-applies">{appliesTo}</p> : null}
        <span className="sf-muted">{renderedState === "ungraded" ? "Your verdict" : "Disagree with the verdict?"}</span>
        {options.map((o) => (
          <button key={o} type="button" className="sf-chip" onClick={() => fillBox(o.toLowerCase())}>
            {o}
          </button>
        ))}
      </div>
    </>
  );
}

/**
 * What people said about this run, kept here as observations, beside what the
 * judge said. Agreement and disagreement are both evidence; neither is hidden.
 */
function KeptVerdicts({ kept, judgeReached }: { kept: readonly KeptVerdict[]; judgeReached: boolean | null }): ReactNode {
  return (
    <ul className="sf-kept-verdicts" aria-label="Verdicts kept on this run">
      {kept.map((v) => {
        const said = v.verdict === "achieved" ? "reached" : v.verdict === "partial" ? "partly" : "not reached";
        const agree = judgeReached === null ? null : (v.verdict === "achieved") === judgeReached;
        return (
          <li key={`${v.observedAt}:${v.verdict}`} data-agree={agree === null ? "unknown" : String(agree)}>
            <span className="sf-kept-who">{v.source === "person" ? (v.by?.name ?? "You") : v.source}</span>: {said}
            {v.note ? <span className="sf-muted"> · {v.note}</span> : null}
            {agree === false ? <span className="sf-kept-disagree"> · the judge said {judgeReached ? "reached" : "not reached"}</span> : null}
            {v.delivery && !v.delivery.recorded ? (
              <span className="sf-kept-unrecorded sf-muted" title={v.delivery.reason ?? undefined}> · not recorded</span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
