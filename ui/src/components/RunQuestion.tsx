/**
 * A question a run asked, shown on that run: the brief exactly as the asker
 * wrote it, and the time it waits. The surface adds no headings or explanation —
 * the brief is the activity's content, and how well it lets a person answer is
 * graded by the outcome, not designed into the interface. The answer is typed in
 * the one box (16f-2); there is no second input here.
 *
 * While it is on screen and open, the run is kept waiting (a heartbeat every
 * 30 s extends goal-host's deadline, up to its cap); off screen, the asker's own
 * deadline stands. An answer goes to the run (`solicitationResponse_write`) and
 * is recorded on the question, so the questions rail shows it answered too.
 */

import { useEffect, useState, type ReactNode } from "react";
import { answerSolicitation, heartbeatSolicitation, SurfaceError } from "../api/client";
import { sendContribution, type Question } from "../api/participation";
import type { SolicitationOutcome } from "../api/types";
import { fromPanel } from "../lib/content";
import { contributionContent } from "../lib/interaction";
import { useNow } from "../lib/useNow";
import { Rendered } from "./Rendered";

const HEARTBEAT_MS = 30_000;

function remaining(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

/**
 * Answer a run's question: to the waiting run (`solicitationResponse_write`), then
 * recorded on the question so the questions rail shows it answered too. The one
 * path for the question card and the box.
 */
export async function answerRunQuestion(
  question: Question,
  outcome: SolicitationOutcome,
  answer: string,
  /** How the outcome was read, when it came from the box's words ("not now"). */
  classified?: { by: string; phrase: string },
) {
  const run = question.run;
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
  return sendContribution({
    ...content,
    response_id: crypto.randomUUID(),
    ...(classified ? { classified_by: classified.by, classified_phrase: classified.phrase } : {}),
  });
}

function answerText(q: Question): string | null {
  const a = q.answers?.[q.answers.length - 1] as { value?: unknown } | undefined;
  if (!a) return null;
  return typeof a.value === "string" ? a.value : JSON.stringify(a.value);
}

export function RunQuestion({ question, running }: { question: Question; running: boolean }): ReactNode {
  const run = question.run;
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

  const given = answerText(question);

  return (
    <section className="sf-view-section sf-run-question" aria-label="Question" data-solicitation-id={question.id}>
      <Rendered content={fromPanel("human_input", question.body)} density="full" header={false} region="run_question" />
      {question.answered && given ? (
        <p className="sf-run-question-answer">{given}</p>
      ) : question.declined ? (
        <p className="sf-muted sf-note">Declined</p>
      ) : open ? (
        deadline !== null ? <p className="sf-muted sf-run-question-deadline">{remaining(deadline - now)}</p> : null
      ) : (
        <p className="sf-muted sf-note">Closed</p>
      )}
    </section>
  );
}
