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
import { useState, type ReactNode } from "react";
import { useSubmitGrade, useVerdicts } from "../api/queries";
import type { KeptVerdict } from "../api/types";
import { gradePayload } from "../lib/interaction";
import { gradeRefusal } from "../lib/refusal";
import { ChoiceInput, InteractionFooter, TextInput, stateOf } from "./Interaction";

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
  const [selected, setSelected] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const grade = useSubmitGrade();
  const options = VERDICT_OPTIONS[renderedState === "reached" && !changedSomething ? "reached-answer" : renderedState];
  const refusal = grade.isError ? gradeRefusal((grade.error as Error).message) : null;
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
  // when it was never recorded. A grade button that posts an undefined key
  // would fail silently at the far end; saying so is the honest rendering.
  if (!executionId) {
    return (
      <div className="sf-grade">
        <p className="sf-note sf-muted">No execution id — cannot be graded</p>
      </div>
    );
  }

  return (
    <>
    {kept.length > 0 ? <KeptVerdicts kept={kept} judgeReached={judgeReached} corpusRefused={refusal ?? null} /> : null}
    <form
      className="sf-grade sf-interaction"
      onSubmit={(e) => {
        e.preventDefault();
        if (!selected) return;
        grade.mutate({ ...gradePayload({ renderedState, option: selected, note, executionId, goal }), ...(dispatchId ? { dispatchId } : {}), judgeReached, about });
      }}
    >
      {appliesTo ? <p className="sf-note sf-muted sf-grade-applies">{appliesTo}</p> : null}
      <ChoiceInput label={renderedState === "ungraded" ? "Your verdict" : "Disagree with the verdict?"} options={options} value={selected} onChange={setSelected} disabled={grade.isPending} />
      <TextInput label="Note" placeholder="Note (optional)" value={note} onChange={setNote} disabled={grade.isPending} />
      <InteractionFooter
        state={stateOf(grade)}
        submitLabel="Record"
        canSubmit={selected !== null}
        error={grade.isError ? refusal ?? `Not recorded: ${(grade.error as Error).message}` : null}
        sentLabel="Recorded"
      />
      {refusal ? (
        <details className="sf-grade-refusal">
          <summary>Server</summary>
          <p className="sf-muted sf-mono">{(grade.error as Error).message}</p>
        </details>
      ) : null}
    </form>
    </>
  );
}

/**
 * What people said about this run, kept here as observations, beside what the
 * judge said. Agreement and disagreement are both evidence; neither is hidden.
 */
function KeptVerdicts({ kept, judgeReached, corpusRefused }: { kept: readonly KeptVerdict[]; judgeReached: boolean | null; corpusRefused: string | null }): ReactNode {
  return (
    <ul className="sf-kept-verdicts" aria-label="Verdicts kept on this run">
      {kept.map((v) => {
        const said = v.verdict === "achieved" ? "reached" : v.verdict === "partial" ? "partly" : "not reached";
        const agree = judgeReached === null ? null : (v.verdict === "achieved") === judgeReached;
        return (
          <li key={`${v.observedAt}:${v.verdict}`} data-agree={agree === null ? "unknown" : String(agree)}>
            <span className="sf-kept-who">{v.source === "person" ? "You" : v.source}</span>: {said}
            {v.note ? <span className="sf-muted"> · {v.note}</span> : null}
            {agree === false ? <span className="sf-kept-disagree"> · the judge said {judgeReached ? "reached" : "not reached"}</span> : null}
          </li>
        );
      })}
      {corpusRefused ? <li className="sf-muted sf-note">Kept here; the learning corpus didn't take it yet.</li> : null}
    </ul>
  );
}
