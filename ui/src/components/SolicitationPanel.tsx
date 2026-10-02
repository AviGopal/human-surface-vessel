/**
 * A mid-walk question is answered WHERE THE RUN IS.
 *
 * The failure this prevents is two half-surfaces: a question on one screen, the
 * run it belongs to on another, and the correlation work falling to the human.
 *
 * HONEST LIMITATION, stated in the UI as well as here: `goalWalkState` does not
 * carry pending solicitations. `poolEvents` is `{shape, source, at}` and
 * nothing else, and the `human_input` impulse that holds the question text and
 * its `solicitation_id` is posted to a separate sink vessel rather than
 * mirrored onto the dispatch record. So the walk log is the only signal here,
 * and when it names a question without its id, this panel says so rather than
 * guessing an id and posting an answer into nowhere.
 */

import { useState, type ReactNode } from "react";
import { fromText } from "../lib/content";
import { Rendered } from "./Rendered";
import { useAnswerSolicitation } from "../api/queries";
import { solicitationPayload } from "../lib/interaction";
import { ChoiceInput, InteractionFooter, TextInput, stateOf } from "./Interaction";
import type { SolicitationOutcome } from "../api/types";
import type { DetectedSolicitation } from "../lib/walk";

const OUTCOMES: readonly { value: SolicitationOutcome; label: string }[] = [
  { value: "answered", label: "Answer it" },
  { value: "insufficient_context", label: "I can't tell from what it gave me" },
  { value: "declined", label: "Decline — don't wait on me" },
];

export function SolicitationPanel({
  solicitation,
}: {
  solicitation: DetectedSolicitation;
}): ReactNode {
  const [answer, setAnswer] = useState("");
  const [outcome, setOutcome] = useState<SolicitationOutcome>("answered");
  const mutation = useAnswerSolicitation();

  return (
    <div className="sf-waiting-panel">
      <p className="sf-label" style={{ margin: 0 }}>
        Waiting on you
      </p>
      <Rendered content={fromText("solicitation_evidence", solicitation.evidenceLine)} density="inline" header={false} />

      {solicitation.solicitationId === null ? null : (
        <form
          className="sf-interaction"
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate(
              solicitationPayload({ solicitationId: solicitation.solicitationId as string, outcome, answer }),
            );
          }}
        >
          <ChoiceInput
            label="Respond"
            options={OUTCOMES.map((o) => o.value)}
            labels={Object.fromEntries(OUTCOMES.map((o) => [o.value, o.label]))}
            value={outcome}
            onChange={(v) => setOutcome(v as SolicitationOutcome)}
            disabled={mutation.isPending}
          />
          <TextInput label="Answer" value={answer} onChange={setAnswer} disabled={mutation.isPending} />
          <InteractionFooter
            state={stateOf(mutation)}
            submitLabel="Send"
            canSubmit={!(outcome === "answered" && answer.trim().length === 0)}
            error={mutation.isError ? `Not delivered: ${(mutation.error as Error).message}` : null}
            sentLabel="Delivered"
          />
        </form>
      )}
    </div>
  );
}
