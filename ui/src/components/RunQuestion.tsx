/**
 * A question a run asked, shown on that run: the brief exactly as the asker
 * wrote it, then the controls. The surface adds no headings or explanation —
 * the brief is the activity's content, and how well it lets a person answer is
 * graded by the outcome, not designed into the interface.
 *
 * While it is on screen and open, the run is kept waiting (a heartbeat every
 * 30 s extends goal-host's deadline, up to its cap); off screen, the asker's own
 * deadline stands. An answer goes to the run (`solicitationResponse_write`) and
 * is recorded on the question, so the questions rail shows it answered too.
 */

import { useMutation } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { answerSolicitation, heartbeatSolicitation, SurfaceError } from "../api/client";
import { sendContribution, type Question } from "../api/participation";
import type { SolicitationOutcome } from "../api/types";
import { fromPanel } from "../lib/content";
import { contributionContent } from "../lib/interaction";
import { useNow } from "../lib/useNow";
import { useQuestions } from "../state/questions";
import { Rendered } from "./Rendered";

const HEARTBEAT_MS = 30_000;

function remaining(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

function answerText(q: Question): string | null {
  const a = q.answers?.[q.answers.length - 1] as { value?: unknown } | undefined;
  if (!a) return null;
  return typeof a.value === "string" ? a.value : JSON.stringify(a.value);
}

export function RunQuestion({ question, running }: { question: Question; running: boolean }): ReactNode {
  const run = question.run;
  const { recordReceipt } = useQuestions();
  const [answer, setAnswer] = useState("");
  const [deadline, setDeadline] = useState<number | null>(run?.deadlineAt ?? null);
  const [closed, setClosed] = useState(false);
  const settled = question.answered || question.declined;
  const open = running && !settled && !closed && run !== undefined;
  const now = useNow(!open);

  useEffect(() => {
    if (!open || !run) return;
    let alive = true;
    const beat = async (): Promise<void> => {
      try {
        const b = await heartbeatSolicitation(run.solicitationId);
        if (alive && typeof b?.deadlineAt === "number") setDeadline(b.deadlineAt);
      } catch (err) {
        // goal-host no longer has it pending: answered elsewhere, timed out, or the walk moved on.
        if (alive && err instanceof SurfaceError && err.httpStatus === 404) setClosed(true);
      }
    };
    void beat();
    const t = setInterval(() => void beat(), HEARTBEAT_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [open, run]);

  const mutation = useMutation({
    retry: false,
    mutationFn: async (outcome: SolicitationOutcome) => {
      if (!run) throw new Error("no run");
      const value = outcome === "answered" ? answer.trim() : outcome;
      await answerSolicitation({ solicitationId: run.solicitationId, outcome, answer: answer.trim() });
      const content = contributionContent({
        panelId: question.id,
        revision: question.revision,
        askId: null,
        kind: outcome === "answered" ? "answer" : "dismiss",
        value,
      });
      return sendContribution({ ...content, response_id: crypto.randomUUID() });
    },
    onSuccess: recordReceipt,
  });

  const given = answerText(question);

  return (
    <section className="sf-view-section sf-run-question" aria-label="Question" data-solicitation-id={question.id}>
      <Rendered content={fromPanel("human_input", question.body)} density="full" header={false} region="run_question" />
      {question.answered && given ? (
        <p className="sf-run-question-answer">{given}</p>
      ) : question.declined ? (
        <p className="sf-muted sf-note">Declined</p>
      ) : open ? (
        <form
          className="sf-run-question-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (answer.trim()) mutation.mutate("answered");
          }}
        >
          <textarea
            className="sf-run-question-input"
            aria-label="Answer"
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            disabled={mutation.isPending}
            rows={3}
          />
          <div className="sf-run-question-actions">
            <button type="submit" className="sf-button" disabled={mutation.isPending || !answer.trim()}>
              Send
            </button>
            <button
              type="button"
              className="sf-button sf-button-quiet"
              disabled={mutation.isPending}
              onClick={() => mutation.mutate("insufficient_context")}
            >
              Need more
            </button>
            <button
              type="button"
              className="sf-button sf-button-quiet"
              disabled={mutation.isPending}
              onClick={() => mutation.mutate("declined")}
            >
              Decline
            </button>
            {deadline !== null ? <span className="sf-muted sf-run-question-deadline">{remaining(deadline - now)}</span> : null}
          </div>
          {mutation.isError ? <p className="sf-error-inline">Not delivered: {(mutation.error as Error).message}</p> : null}
        </form>
      ) : (
        <p className="sf-muted sf-note">Closed</p>
      )}
    </section>
  );
}
