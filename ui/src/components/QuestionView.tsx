/**
 * One question from the system, open in the main pane, with the response form.
 *
 * The exact revision being answered is held; a newer revision must be reviewed
 * before a response can be sent against it. Retrying an uncertain delivery
 * reuses its response id, so it cannot manufacture a second response.
 */

import { useMutation } from "@tanstack/react-query";
import { useId, useRef, useState, type ReactNode } from "react";
import { sendContribution, type Contribution, type Question } from "../api/participation";
import { reportExposureAct } from "../lib/exposure-reporter";
import { questionGapId, questionSubject, useQuestions } from "../state/questions";
import { contributionContent, questionForAsk } from "../lib/interaction";
import { ChoiceInput, InteractionFooter, TextInput, stateOf } from "./Interaction";
import { fromPanel, fromResponse } from "../lib/content";
import { ComplainButton } from "./ComplainButton";
import { answerReaderFor, gapIdForPanel } from "../lib/disposition";
import { EscalationForm, EscalationOutcome, LocalizationForm, UnreadNote, VerificationForm } from "./ResponseForms";
import { Rendered } from "./Rendered";

/** The pin key a question body is planned under. */
export const QUESTION_CONTENT_SHAPE = "human_question";

function QuestionCard({ incoming }: { incoming: Question }): ReactNode {
  const { recordReceipt } = useQuestions();
  const [question, setQuestion] = useState(incoming);
  const [text, setText] = useState("");
  const [format, setFormat] = useState<"text" | "json">("text");
  const [error, setError] = useState("");
  const id = useId();
  const pending = useRef<{ signature: string; contribution: Contribution } | null>(null);
  const mutation = useMutation({ mutationFn: sendContribution, retry: false, onSuccess: recordReceipt });
  const revised = incoming.revision !== question.revision;
  const gapId = questionGapId(question);

  const [askValues, setAskValues] = useState<Record<string, string | number | null>>({});
  const [lastAsk, setLastAsk] = useState<string | null>(null);

  /** One write for every response path; the same payload retried keeps its response id. */
  function send(kind: "answer" | "dismiss", askId: string | null, value: unknown): void {
    const content = contributionContent({ panelId: question.id, revision: question.revision, askId, kind, value });
    const signature = JSON.stringify(content);
    if (pending.current?.signature !== signature) {
      pending.current = { signature, contribution: { ...content, response_id: crypto.randomUUID() } };
    }
    setLastAsk(askId);
    mutation.mutate(pending.current.contribution);
  }

  function submitWhole(kind: "answer" | "dismiss"): void {
    setError("");
    let value: unknown = text;
    if (kind === "answer" && !text.trim()) {
      setError("Write a response first.");
      return;
    }
    if (kind === "answer" && format === "json") {
      try {
        value = JSON.parse(text);
      } catch {
        setError("Not valid JSON.");
        return;
      }
    }
    send(kind, null, value);
  }

  const state = stateOf(mutation);
  const reader = answerReaderFor(question.id);
  const escalatedGap = gapIdForPanel(question.id);
  // The answer the reader will act on: the newest non-decline, whether just sent or from an earlier visit.
  const latestAnswer =
    [...incoming.responses, ...(mutation.data ? [mutation.data] : [])]
      .filter((r) => r.kind === "answer")
      .sort((a, b) => b.receivedAt - a.receivedAt)[0] ?? null;
  const formProps = {
    send: (kind: "answer" | "dismiss", value: unknown) => send(kind, null, value),
    state: lastAsk === null ? state : ("idle" as const),
    error: lastAsk === null && mutation.isError ? `Not delivered: ${mutation.error.message}. Retry sends the same response.` : null,
    revised,
  };

  return (
    <article className="sf-question" aria-labelledby={`${id}-title`}>
      <header className="sf-view-head">
        <p className="sf-view-eyebrow">{question.title}</p>
        <h2 id={`${id}-title`} className="sf-view-title sf-question-subject">
          {questionSubject(question)}
        </h2>
        <p className="sf-view-facts">
          {gapId ? <span className="sf-mono">{gapId}</span> : null}
          {question.answered ? <span className="sf-chip">answered</span> : null}
          {question.declined ? <span className="sf-chip">declined</span> : null}
          {question.because?.map((reason) => (
            <span key={reason} className="sf-chip sf-chip-quiet">
              {reason}
            </span>
          ))}
        </p>
      </header>

      <section className="sf-view-section">
        <div data-question-body={question.id} data-form-shape={QUESTION_CONTENT_SHAPE}>
          <Rendered content={fromPanel(QUESTION_CONTENT_SHAPE, question.body)} density="full" header={false} region="question_card" />
        </div>
      </section>

      {revised ? (
        <div className="sf-warn">
          This question changed.{" "}
          <button
            type="button"
            className="sf-button"
            onClick={() => {
              setQuestion(incoming);
              setAskValues({});
              mutation.reset();
              setError("");
              pending.current = null;
            }}
          >
            Show new version
          </button>
        </div>
      ) : null}

      {question.asks?.length ? (
        <section className="sf-view-section sf-respond" aria-label="Parts of this question">
          {question.asks.map((part) => {
            const q = questionForAsk(part);
            const v = askValues[part.id] ?? null;
            const set = (nv: string | number | null): void => {
              setAskValues((prev) => ({ ...prev, [part.id]: nv }));
              mutation.reset();
            };
            return (
              <form
                key={part.id}
                className="sf-interaction sf-ask-part"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (v === null || v === "") return;
                  send("answer", part.id, v);
                }}
              >
                {q.kind === "choice" ? (
                  <ChoiceInput label={part.prompt} options={q.options} value={typeof v === "string" ? v : null} onChange={set} disabled={revised || state === "pending"} />
                ) : q.kind === "number" ? (
                  <label className="sf-ix-choice">
                    <span className="sf-ix-label">{part.prompt}</span>
                    <input
                      type="number"
                      className="sf-input"
                      value={typeof v === "number" ? v : ""}
                      disabled={revised || state === "pending"}
                      onChange={(e) => set(e.target.value === "" ? null : Number(e.target.value))}
                    />
                  </label>
                ) : (
                  <>
                    <span className="sf-ix-label">{part.prompt}</span>
                    <TextInput label={part.prompt} value={typeof v === "string" ? v : ""} onChange={set} disabled={revised || state === "pending"} />
                  </>
                )}
                <InteractionFooter
                  state={lastAsk === part.id ? state : "idle"}
                  submitLabel="Send"
                  canSubmit={!revised && v !== null && v !== ""}
                  error={lastAsk === part.id && mutation.isError ? `Not delivered: ${mutation.error.message}. Retry sends the same response.` : null}
                />
              </form>
            );
          })}
        </section>
      ) : null}

      {reader === "escalation" && escalatedGap ? (
        <>
          <EscalationForm {...formProps} />
          <EscalationOutcome gapId={escalatedGap} response={latestAnswer} />
        </>
      ) : reader === "pending_verification" ? (
        <VerificationForm {...formProps} />
      ) : reader === "localization" ? (
        <LocalizationForm {...formProps} />
      ) : (
        <>
        <form
          className="sf-view-section sf-respond sf-interaction"
          onSubmit={(event) => {
            event.preventDefault();
            submitWhole("answer");
          }}
        >
          <TextInput
            label="Your response"
            placeholder={question.answered ? "Add to your response" : question.asks?.length ? "Respond to the whole question" : "Your response"}
            value={text}
            onChange={(v) => {
              setText(v);
              mutation.reset();
            }}
            disabled={state === "pending"}
            format={format}
            onFormat={(f) => {
              setFormat(f);
              mutation.reset();
            }}
          />
          <InteractionFooter
            state={lastAsk === null ? state : "idle"}
            submitLabel="Send"
            canSubmit={!revised}
            error={
              error ||
              (lastAsk === null && mutation.isError ? `Not delivered: ${mutation.error.message}. Retry sends the same response.` : null)
            }
            sentLabel={mutation.data?.kind === "dismiss" ? "Declined" : "Sent"}
            secondary={
              <button type="button" className="sf-button" disabled={state === "pending" || revised} onClick={() => submitWhole("dismiss")}>
                Decline
              </button>
            }
          />
        </form>
          {reader === "docs_decision" ? <UnreadNote /> : null}
        </>
      )}

      <details className="sf-view-section sf-history">
        <summary>
          History · {incoming.responses.length} response{incoming.responses.length === 1 ? "" : "s"} · rev{" "}
          {question.revision}
        </summary>
        {incoming.responses.map((response) => (
          <div key={response.id} className="sf-history-item">
            <p className="sf-history-meta">
              {response.kind} · rev {response.panelRevision ?? 1}
              {response.askId ? ` · part ${response.askId}` : ""} · <span className="sf-mono">{response.id}</span>
            </p>
            <Rendered content={fromResponse("human_contribution", response.value, response.receivedAt)} density="inline" header={false} region="response_history" />
          </div>
        ))}
        <p className="sf-history-meta">
          <span className="sf-mono">{question.id}</span>
        </p>
      </details>

      <div className="sf-question-complain">
        <ComplainButton region={question.id} onFiled={() => reportExposureAct(question.id, "complained")} />
      </div>
    </article>
  );
}

export function QuestionView({ questionId }: { questionId: string }): ReactNode {
  const { ordered, query } = useQuestions();
  const question = ordered.find((q) => q.id === questionId);
  if (!question) {
    return <p className="sf-main-empty">{query.isPending ? "Loading…" : "This question is no longer listed."}</p>;
  }
  // Keyed so a different question gets a fresh draft and a fresh held revision.
  return <QuestionCard key={question.id} incoming={question} />;
}
