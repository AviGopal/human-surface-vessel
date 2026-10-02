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
import { useSubmitGrade } from "../api/queries";
import { gradePayload } from "../lib/interaction";
import { ChoiceInput, InteractionFooter, TextInput, stateOf } from "./Interaction";

export function GradeGesture({
  renderedState,
  executionId,
  goal,
  alreadyGraded,
  humanReachNotes,
  appliesTo = null,
}: {
  renderedState: "reached" | "not-reached";
  /** ABSENT when goal-host never recorded one — the key is not serialized. */
  executionId: string | undefined;
  goal: string;
  alreadyGraded: boolean;
  humanReachNotes: string | null;
  /** Which attempt a grade lands on, when the run walked more than once. */
  appliesTo?: string | null;
}): ReactNode {
  const [selected, setSelected] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const grade = useSubmitGrade();
  const options = VERDICT_OPTIONS[renderedState];

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
    <form
      className="sf-grade sf-interaction"
      onSubmit={(e) => {
        e.preventDefault();
        if (!selected) return;
        grade.mutate(gradePayload({ renderedState, option: selected, note, executionId, goal }));
      }}
    >
      {appliesTo ? <p className="sf-note sf-muted sf-grade-applies">{appliesTo}</p> : null}
      <ChoiceInput label="Disagree with the verdict?" options={options} value={selected} onChange={setSelected} disabled={grade.isPending} />
      <TextInput label="Note" placeholder="Note (optional)" value={note} onChange={setNote} disabled={grade.isPending} />
      <InteractionFooter
        state={stateOf(grade)}
        submitLabel="Record"
        canSubmit={selected !== null}
        error={grade.isError ? `Not recorded: ${(grade.error as Error).message}` : null}
        sentLabel="Recorded"
      />
    </form>
  );
}
