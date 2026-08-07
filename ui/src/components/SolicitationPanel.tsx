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
import { useAnswerSolicitation } from "../api/queries";
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
        This run is waiting on you
      </p>
      <p className="sf-mono" style={{ fontSize: "var(--sf-text-sm)" }}>
        {solicitation.evidenceLine}
      </p>

      {solicitation.solicitationId === null ? (
        <p className="sf-note">
          The walk log says a question was asked but does not carry its id, and the question itself
          lives in a separate impulse this surface cannot read. There is no way to answer it from
          here — the run will time out on its own.
        </p>
      ) : (
        <>
          <label className="sf-label" htmlFor="sf-solicit-answer">
            Your answer
          </label>
          <textarea
            id="sf-solicit-answer"
            className="sf-textarea"
            style={{ minHeight: "4.5rem", fontSize: "var(--sf-text-base)" }}
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
          />
          <div
            style={{
              display: "flex",
              gap: "var(--sf-space-2)",
              alignItems: "center",
              marginTop: "var(--sf-space-2)",
              flexWrap: "wrap",
            }}
          >
            <label className="sf-label" htmlFor="sf-solicit-outcome">
              As
            </label>
            <select
              id="sf-solicit-outcome"
              className="sf-select"
              value={outcome}
              onChange={(e) => setOutcome(e.target.value as SolicitationOutcome)}
            >
              {OUTCOMES.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="sf-button sf-button-primary"
              disabled={mutation.isPending || (outcome === "answered" && answer.trim().length === 0)}
              onClick={() =>
                mutation.mutate({
                  solicitationId: solicitation.solicitationId as string,
                  outcome,
                  answer: answer.trim(),
                })
              }
            >
              {mutation.isPending ? "Sending…" : "Send to the walk"}
            </button>
          </div>
          {mutation.isError ? (
            <p className="sf-error">
              The answer was not delivered: {(mutation.error as Error).message}. The walk is still
              waiting.
            </p>
          ) : null}
          {mutation.isSuccess ? <p className="sf-ok">Delivered. The walk resumes from where it stopped.</p> : null}
        </>
      )}
    </div>
  );
}
