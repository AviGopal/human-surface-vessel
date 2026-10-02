/**
 * One run, open in the main pane: what was asked, the verdict, the answer,
 * the trace, and the human's levers (context while running, a grade after).
 *
 * The verdict is the badge and it leads. `status` is shown only as a fact
 * beside it, never in the place a reader scans for the outcome.
 */

import { useState, type ReactNode } from "react";
import { useInjectContext, useWalk } from "../api/queries";
import { fromText } from "../lib/content";
import { injectPayload } from "../lib/interaction";
import { InteractionFooter, TextInput, stateOf } from "./Interaction";
import type { ExecutionPath, GoalWalkState } from "../api/types";
import type { RunState } from "@avigopal/design-tokens";
import { deriveRunState, stateIsTerminal } from "../lib/runState";
import { detectSolicitation, hasProgress, progressFingerprint } from "../lib/walk";
import { useNow } from "../lib/useNow";
import { useProgressWatch } from "../lib/useProgressWatch";
import { useLiveControls } from "../state/liveControls";
import { segmentAttempts } from "../lib/attempts";
import { AnswerBody } from "./Answer";
import { Chain } from "./Chain";
import { isWriteShape } from "../lib/shapes";
import { RunQuestion } from "./RunQuestion";
import { useQuestions } from "../state/questions";
import { Rendered } from "./Rendered";
import { GradeGesture } from "./GradeGesture";
import { SolicitationPanel } from "./SolicitationPanel";
import { StateBadge } from "./StateBadge";
import { Trace } from "./Trace";

const PATH_LABEL: Readonly<Record<ExecutionPath, string>> = {
  learned_pathway: "learned path",
  satisfier: "direct",
  universal_tool_fallback: "tool loop",
  feature_compose: "code edit",
  fresh_derivation: "new path",
};

function InjectContext({ dispatchId }: { dispatchId: string }): ReactNode {
  const [content, setContent] = useState("");
  const [shape, setShape] = useState("human_context");
  const mutation = useInjectContext();

  return (
    <details className="sf-view-section sf-inject">
      <summary>Add other context</summary>
      <form
        className="sf-inject-body sf-interaction"
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate(injectPayload({ dispatchId, shape, content }));
        }}
      >
        <TextInput label="Shape" value={shape} onChange={setShape} singleLine mono disabled={mutation.isPending} />
        <TextInput label="Content" value={content} onChange={setContent} disabled={mutation.isPending} />
        <InteractionFooter
          state={stateOf(mutation)}
          submitLabel="Add"
          canSubmit={content.trim().length > 0 && shape.trim().length > 0}
          error={mutation.isError ? (mutation.error as Error).message : null}
          sentLabel="Added"
        />
      </form>
    </details>
  );
}

/**
 * What the walk is missing, and a way to supply it.
 *
 * `pendingTargets` are the shapes the walk still needs; an impulse of one of those
 * shapes is the only human contribution that can satisfy the walk (free-form
 * `human_context` is consumed by no activity). Readback is the next walk read: the
 * shape leaves `pendingTargets` once the walk has taken it in.
 */
function WalkNeeds({ walk }: { walk: GoalWalkState }): ReactNode {
  const [shape, setShape] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const mutation = useInjectContext();
  const missing = walk.pendingTargets;
  if (missing.length === 0 && !sent) return null;
  const stillMissing = sent !== null && missing.includes(sent);

  return (
    <section className="sf-view-section sf-walk-needs" aria-label="What the walk is missing">
      <h3 className="sf-view-label">Missing</h3>
      {missing.length > 0 ? (
        <ul className="sf-needs-list">
          {missing.map((s) => (
            <li key={s}>
              <span className="sf-shape-badge">{s}</span>
              {isWriteShape(s) ? null : (
              <button
                type="button"
                className="sf-button sf-button-quiet"
                aria-pressed={shape === s}
                onClick={() => {
                  setShape(s);
                  mutation.reset();
                }}
              >
                Provide
              </button>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {shape ? (
        <form
          className="sf-interaction"
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate(injectPayload({ dispatchId: walk.dispatchId, shape, content }), {
              onSuccess: () => {
                setSent(shape);
                setContent("");
                setShape(null);
              },
            });
          }}
        >
          <TextInput label={`Provide ${shape}`} placeholder={`Content for ${shape}`} value={content} onChange={setContent} disabled={mutation.isPending} />
          <InteractionFooter
            state={stateOf(mutation)}
            submitLabel="Add to the walk"
            canSubmit={content.trim().length > 0}
            error={mutation.isError ? (mutation.error as Error).message : null}
            sentLabel="In the pool"
          />
        </form>
      ) : null}
      {sent ? (
        <p className="sf-outcome-strip" data-outcome={stillMissing ? "waiting" : "applied"}>
          {stillMissing ? `${sent} · in the pool` : `${sent} · taken`}
        </p>
      ) : null}
    </section>
  );
}

function spanMs(walk: GoalWalkState): number | null {
  const times = [
    ...walk.poolEvents.map((e) => e.at),
    ...walk.steps.map((s) => (typeof s["at"] === "number" ? (s["at"] as number) : undefined)),
  ].filter((t): t is number => typeof t === "number" && Number.isFinite(t));
  if (times.length < 2) return null;
  return Math.max(...times) - Math.min(...times);
}

function duration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function RunView({ dispatchId }: { dispatchId: string }): ReactNode {
  const { paused, intervalMs } = useLiveControls();
  const now = useNow(paused);
  // No hover-freeze here: nothing in this pane reorders under a hand, and a
  // run that stopped updating while the top bar says "Live" would be lying.
  // The global pause is the reader's lever.
  const query = useWalk(dispatchId, { enabled: !paused, intervalMs });
  // The LIVE question list, not the rail's accepted snapshot: a run's question must
  // appear while the run waits, without the reader accepting an update first.
  const liveQuestions = useQuestions().query.data?.questions;
  const walk = query.data;
  const quietForMs = useProgressWatch(walk ? progressFingerprint(walk) : "", now);

  if (!walk) {
    return (
      <p className="sf-main-empty">
        {query.isError ? `Could not read this run: ${(query.error as Error).message}` : "Loading…"}
      </p>
    );
  }

  // A question this run asked, delivered to this surface and verified against the run.
  const runQuestion =
    liveQuestions?.find((q) => q.run?.linked === true && q.run.dispatchId === walk.dispatchId) ?? null;
  // The walk-log fallback is only for asks delivered somewhere else.
  const solicitation = runQuestion ? null : detectSolicitation(walk);
  const terminal = walk.status !== "running";
  const state: RunState = deriveRunState({
    status: walk.status,
    reached: walk.reached,
    awaitingAnswer: solicitation !== null,
    hasProgress: hasProgress(walk),
    quietForMs: terminal ? null : quietForMs,
    // goalWalkState carries no startedAt; the board row judges accept-silence.
    acceptedForMs: null,
  });
  const span = spanMs(walk);
  const reason = state === "not-reached" ? (walk.goalReachReason?.trim() || walk.error || null) : null;
  const who = walk.operator ?? walk.trigger;
  const answer = walk.answerBody?.trim() ? walk.answerBody : null;
  // Several walks: say WHICH one the verdict, answer and grade belong to. It is
  // the reported walk, which is not necessarily the last one.
  const segments = segmentAttempts(walk);
  const reportedSeg = segments.find((s) => s.reported) ?? null;
  const attemptNote =
    segments.length > 1
      ? reportedSeg
        ? `attempt ${reportedSeg.number} of ${segments.length} reported`
        : `${segments.length} attempts`
      : null;

  return (
    <article className="sf-run" data-state={state} aria-busy={query.isFetching}>
      <header className="sf-view-head">
        <h2 className="sf-view-title sf-run-title">
          {walk.goal ?? <span className="sf-muted">goal text not recorded</span>}
        </h2>
        <p className="sf-view-facts">
          <StateBadge state={state} />
          {span !== null ? <span>{duration(span)}</span> : null}
          {who ? <span>{who}</span> : null}
          {walk.executionPath ? <span className="sf-chip">{PATH_LABEL[walk.executionPath]}</span> : null}
          {walk.humanGraded ? <span className="sf-chip">human-graded</span> : null}
          {attemptNote ? <span className="sf-chip sf-chip-quiet">{attemptNote}</span> : null}
          <span className="sf-mono sf-view-id" title={walk.executionId ?? undefined}>
            {walk.dispatchId}
          </span>
          {walk.requeueOf ? <span className="sf-mono">requeue of {walk.requeueOf}</span> : null}
          {query.isError ? <span className="sf-error-inline">refresh failed</span> : null}
        </p>
        {reason ? (
          <div className="sf-run-reason-full">
            <Rendered content={fromText("goal_reach_reason", reason)} density="inline" header={false} region="run_reason" />
          </div>
        ) : null}
        {walk.humanReachNotes ? <p className="sf-run-reason-full">“{walk.humanReachNotes}”</p> : null}
      </header>

      {walk.status === "running" ? <WalkNeeds walk={walk} /> : null}

      {runQuestion ? <RunQuestion question={runQuestion} running={walk.status === "running"} /> : null}

      {solicitation ? (
        <section className="sf-view-section">
          <SolicitationPanel solicitation={solicitation} />
        </section>
      ) : null}

      {answer ? (
        <section className="sf-view-section" aria-label="Answer">
          <h3 className="sf-view-label">Answer</h3>
          <AnswerBody answerBody={answer} goal={walk.goal} dispatchId={walk.dispatchId} />
        </section>
      ) : null}

      <Chain walk={walk} />

      <details className="sf-view-section sf-provenance" aria-label="Provenance">
        <summary className="sf-view-label">Provenance</summary>
        <Trace walk={walk} />
      </details>

      {walk.status === "running" ? <InjectContext dispatchId={walk.dispatchId} /> : null}

      {stateIsTerminal(state) ? (
        <section className="sf-view-section" aria-label="Grade">
          <h3 className="sf-view-label">Grade</h3>
          <GradeGesture
            renderedState={state === "reached" ? "reached" : "not-reached"}
            executionId={walk.executionId}
            goal={walk.goal ?? ""}
            alreadyGraded={walk.humanGraded}
            appliesTo={
              segments.length > 1
                ? reportedSeg
                  ? `Attempt ${reportedSeg.number} of ${segments.length}`
                  : `Reported attempt (of ${segments.length})`
                : null
            }
            humanReachNotes={walk.humanReachNotes}
          />
        </section>
      ) : null}
    </article>
  );
}
