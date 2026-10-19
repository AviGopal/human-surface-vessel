/**
 * One run, open in the main pane: what was asked, the verdict, the answer,
 * the trace, and the human's levers (context while running, a grade after).
 *
 * The verdict is the badge and it leads. `status` is shown only as a fact
 * beside it, never in the place a reader scans for the outcome.
 */

import type { ReactNode } from "react";
import { useWalk } from "../api/queries";
import { useBoxTarget } from "../state/boxTarget";
import { fromText } from "../lib/content";
import type { ExecutionPath, GoalWalkState } from "../api/types";
import type { RunState } from "@avigopal/design-tokens";
import { deriveRunState, stalledForMs, stateIsTerminal, type RunFacts } from "../lib/runState";
import { hasProgress, openRunQuestion, progressFingerprint } from "../lib/walk";
import { useNow } from "../lib/useNow";
import { useProgressWatch } from "../lib/useProgressWatch";
import { useLiveControls } from "../state/liveControls";
import { segmentAttempts } from "../lib/attempts";
import { AnswerBody, answerIsVerdict, basisContent } from "./Answer";
import { linksIn } from "../lib/links";
import { KNOWNNESS_LABEL, knownness } from "../lib/knownness";
import { Attempts } from "./Attempts";
import { answerNode, buildChains } from "../lib/chain";
import { fromProvenance } from "../lib/content";
import { Chain, FoundLinks } from "./Chain";
import { splitVerdict } from "../lib/verdict";
import { RunQuestion } from "./RunQuestion";
import { useQuestions } from "../state/questions";
import { Rendered } from "./Rendered";
import { GradeGesture } from "./GradeGesture";
import { PersonMark } from "./PersonMark";
import { fromAPerson, personDrivenStep } from "../lib/provenance";
import { StateBadge } from "./StateBadge";
import { Trace } from "./Trace";

const PATH_LABEL: Readonly<Record<ExecutionPath, string>> = {
  learned_pathway: "learned path",
  satisfier: "direct",
  universal_tool_fallback: "tool loop",
  feature_compose: "code edit",
  fresh_derivation: "new path",
};

/**
 * What the walk still needs, and a way to supply it.
 *
 * `pendingTargets` are the shapes the walk still needs; an impulse of one of those
 * shapes is the only human contribution that can satisfy the walk (free-form
 * `human_context` is consumed by no activity). Readback is the next walk read: the
 * shape leaves `pendingTargets` once the walk has taken it in.
 */
function WalkNeeds({ walk }: { walk: GoalWalkState }): ReactNode {
  const box = useBoxTarget();
  const missing = walk.pendingTargets;
  const sent = box?.sent?.dispatchId === walk.dispatchId ? box.sent.shape : null;
  if (missing.length === 0 && !sent) return null;
  const stillMissing = sent !== null && missing.includes(sent);
  const chosen = box?.target?.dispatchId === walk.dispatchId ? box.target.shape : null;

  return (
    // Folded until a person opens it or has sent something: it is where a running walk
    // says what it is stuck on, and anything listed may be supplied.
    <details className="sf-view-section sf-walk-needs" aria-label="What the walk still needs" open={sent !== null || chosen !== null}>
      <summary className="sf-view-label">Needed · {missing.length}</summary>
      {missing.length > 0 ? (
        <ul className="sf-needs-list">
          {missing.map((s) => (
            <li key={s}>
              <span className="sf-shape-badge">{s}</span>
              {/* Anything the walk still needs may be supplied: what a person writes is a
                  person's input by provenance, whatever its shape. Provide chooses the
                  target; the text goes in the one box. */}
              <button
                type="button"
                className="sf-button sf-button-quiet"
                aria-pressed={chosen === s}
                disabled={!box}
                onClick={() => box?.choose({ dispatchId: walk.dispatchId, shape: s })}
              >
                Provide
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {sent ? (
        <p className="sf-outcome-strip" data-outcome={stillMissing ? "waiting" : "applied"}>
          {stillMissing ? `${sent} · in the pool` : `${sent} · taken`}
        </p>
      ) : null}
    </details>
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
  const terminal = walk.status !== "running";
  const facts: RunFacts = {
    status: walk.status,
    reached: walk.reached,
    awaitingAnswer: !terminal && openRunQuestion(liveQuestions, walk.dispatchId, null) !== null,
    hasProgress: hasProgress(walk),
    quietForMs: terminal ? null : quietForMs,
    // goalWalkState carries no startedAt; the board row judges accept-silence.
    acceptedForMs: null,
  };
  const state: RunState = deriveRunState(facts);
  const span = spanMs(walk);
  const reason = state === "not-reached" || state === "ungraded" ? (walk.goalReachReason?.trim() || walk.error || null) : null;
  const who = walk.operator ?? walk.trigger;
  const answer = walk.answerBody?.trim() ? walk.answerBody : null;
  // The builder pastes the reach verdict where no step wrote an answer: label it as what it is.
  const verdictOnly = answer !== null && answerIsVerdict(answer, walk.goal ?? undefined, walk.goalReachReason);
  // A reached run whose "answer" is only the verdict: what it produced leads as
  // the answer, and the verdict follows as a line.
  const promoted = walk.reached === true && verdictOnly ? answerNode(buildChains(walk), walk.completionShapes) : null;
  const promotedContent = promoted ? fromProvenance(promoted.raw) : null;
  const promotedFromPerson = promoted ? fromAPerson(promoted.producedBy, personDrivenStep(walk.dispatchId, walk.walkLog, liveQuestions)) : false;
  // Its outputs expired: the record the answer was reasoned from is the answer.
  const basisLead = walk.reached === true && verdictOnly && answer !== null && !(promoted && promotedContent)
    ? basisContent(answer, walk.goal ?? undefined, walk.dispatchId, walk.completionShapes)
    : null;
  const known = knownness(walk);
  // A search record answers with its links, as the outputs view already draws them.
  const basisLinks = basisLead ? linksIn(basisLead.body) : [];
  // Several walks: say WHICH one the verdict, answer and grade belong to. It is
  // the reported walk, which is not necessarily the last one.
  const segments = segmentAttempts(walk);
  const reportedSeg = segments.find((s) => s.reported) ?? null;
  // An expired run keeps its attempt count but not the events the strip counts.
  const attemptsShown = Math.max(segments.length, walk.attemptCount ?? 0);
  // Outputs that expired say only "Not retained": that belongs in the fold, not above it.
  const outputsRetained = (walk.poolProvenance ?? []).length > 0;


  return (
    <article className="sf-run" data-state={state} aria-busy={query.isFetching}>
      <header className="sf-view-head">
        <h2 className="sf-view-title sf-run-title">
          {walk.goal ?? <span className="sf-muted">goal text not recorded</span>}
        </h2>
        <p className="sf-view-facts">
          <StateBadge state={state} quietForMs={stalledForMs(facts)} />
          {span !== null ? <span>{duration(span)}</span> : null}
          {who ? <span>{who}</span> : null}
          {walk.executionPath ? <span className="sf-chip">{PATH_LABEL[walk.executionPath]}</span> : null}
          {walk.humanGraded ? <span className="sf-chip">human-graded</span> : null}
          <span className="sf-mono sf-view-id" title={walk.executionId ?? undefined}>
            {walk.dispatchId}
          </span>
          {walk.requeueOf ? <span className="sf-mono">requeue of {walk.requeueOf}</span> : null}
          {query.isError ? <span className="sf-error-inline">refresh failed</span> : null}
        </p>
        {reason ? (
          // The system's code for the reason stays on hover; the fold draws it beside each attempt.
          <div className="sf-run-reason-full" title={splitVerdict(reason).code ?? undefined}>
            <Rendered content={fromText("goal_reach_reason", splitVerdict(reason).text)} density="inline" header={false} region="run_reason" />
          </div>
        ) : null}
        {walk.humanReachNotes ? <p className="sf-run-reason-full">“{walk.humanReachNotes}”</p> : null}
        {known === "not-understood" ? <p className="sf-known-line" data-known="not-understood">Didn't understand the question: inference returned no target.</p> : null}
      </header>

      {walk.status === "running" ? <Attempts walk={walk} segments={segments} /> : null}

      {walk.status === "running" ? <WalkNeeds walk={walk} /> : null}

      {runQuestion ? <RunQuestion question={runQuestion} running={walk.status === "running"} /> : null}

      {answer ? (
        <>
        {promoted && promotedContent ? (
          <section className="sf-view-section sf-known" data-known={known} aria-label="Answer">
            <h3 className="sf-view-label">Answer{KNOWNNESS_LABEL[known] ? <span className="sf-known-label"> · {KNOWNNESS_LABEL[known]}</span> : null} <PersonMark fromPerson={promotedFromPerson} /></h3>
            <Rendered content={promotedContent} density="full" header={false} region="run_answer" lead />
          </section>
        ) : basisLead ? (
          <section className="sf-view-section sf-known" data-known={known} aria-label="Answer">
            <h3 className="sf-view-label">Answer{KNOWNNESS_LABEL[known] ? <span className="sf-known-label"> · {KNOWNNESS_LABEL[known]}</span> : null}</h3>
            {basisLinks.length > 0 ? (
              <FoundLinks links={basisLinks} />
            ) : (
              <Rendered content={basisLead} density="full" header={false} region="run_answer" lead />
            )}
          </section>
        ) : null}
        {walk.reached === true && verdictOnly && !(promoted && promotedContent) && !basisLead && (walk.completionShapes ?? []).length > 0 ? (
          <p className="sf-note sf-muted sf-answer-lost">The answer's content wasn't kept: what the judge credited ({(walk.completionShapes ?? []).join(", ")}) survives only as a placeholder.</p>
        ) : null}
        <section
          className={`sf-view-section${(promoted && promotedContent) || basisLead ? " sf-verdict-compact" : " sf-known"}`}
          data-known={(promoted && promotedContent) || basisLead || verdictOnly ? undefined : known}
          aria-label={verdictOnly ? "Verdict" : "Answer"}
        >
          <h3 className="sf-view-label">
            {verdictOnly ? "Verdict" : "Answer"}
            {!verdictOnly && KNOWNNESS_LABEL[known] ? <span className="sf-known-label"> · {KNOWNNESS_LABEL[known]}</span> : null}
          </h3>
          <AnswerBody answerBody={answer} goal={walk.goal} dispatchId={walk.dispatchId} hideBasis={basisLead !== null || (walk.reached === true && verdictOnly && (walk.completionShapes ?? []).length > 0)} />
        </section>
        </>
      ) : null}

      {walk.status === "running" ? (
        <>
          <Chain walk={walk} exclude={promoted && promotedContent ? promoted.id : null} />
          <details className="sf-view-section sf-provenance" aria-label="Provenance">
            <summary className="sf-view-label">Provenance</summary>
            <Trace walk={walk} />
          </details>
        </>
      ) : (
        <>
          {/* No answer: what the run produced is the only content, so it stays open. */}
          {answer || !outputsRetained ? null : <Chain walk={walk} exclude={null} />}
          <details className="sf-view-section sf-how" aria-label="How it went">
            <summary className="sf-view-label">
              How it went · {attemptsShown === 1 ? "1 attempt" : `${attemptsShown} attempts`}
              {span !== null ? ` · ${duration(span)}` : ""}
            </summary>
            <Attempts walk={walk} segments={segments} />
            {answer || !outputsRetained ? <Chain walk={walk} exclude={promoted && promotedContent ? promoted.id : null} /> : null}
            <details className="sf-view-section sf-provenance" aria-label="Provenance">
              <summary className="sf-view-label">Provenance</summary>
              <Trace walk={walk} />
            </details>
          </details>
        </>
      )}


      {stateIsTerminal(state) ? (
        <section className="sf-view-section" aria-label="Grade">
          <h3 className="sf-view-label">Grade</h3>
          <GradeGesture
            renderedState={state === "reached" ? "reached" : state === "ungraded" ? "ungraded" : "not-reached"}
            executionId={walk.executionId}
            goal={walk.goal ?? ""}
            alreadyGraded={walk.humanGraded}
            changedSomething={walk.executionPath === "feature_compose"}
            dispatchId={walk.dispatchId}
            judgeReached={walk.reached}
            about={promoted && promotedContent ? { pool_id: promoted.id, shape: promoted.shape, ...(promoted.producedBy ? { produced_by: promoted.producedBy } : {}), ...(promotedFromPerson ? { provenance: "from-a-person" } : {}) } : null}
            appliesTo={
              // One count on the page: the same total the fold shows. An attempt is named by
              // its number only when the walk's segments are the attempts themselves.
              attemptsShown > 1
                ? reportedSeg && segments.length === attemptsShown
                  ? `Attempt ${reportedSeg.number} of ${attemptsShown}`
                  : `Reported attempt (of ${attemptsShown})`
                : null
            }
            humanReachNotes={walk.humanReachNotes}
          />
        </section>
      ) : null}
    </article>
  );
}
