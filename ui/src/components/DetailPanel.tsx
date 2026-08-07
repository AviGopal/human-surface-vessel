/**
 * DETAIL — opens on click, holds until dismissed, addressable by URL.
 *
 * Four parts, in this order, and the order is the argument:
 *
 *   1. what was asked          — the goal as typed
 *   2. what happened           — one honest sentence; a hollow completion is
 *                                reported as not reached
 *   3. what it produced        — THE EVIDENCE LEDGER, content first
 *   4. what happens next       — retry, salvage, grade, or done
 *
 * Explanation is offered where it REPAIRS — on failure — rather than sprayed
 * across successes, where it manufactures over-reliance. The walk log is here
 * and collapsed for the same reason.
 */

import type { RunState } from "@avigopal/design-tokens";
import type { ReactNode } from "react";
import { useState } from "react";
import { useInjectContext, useWalk,
  useRenderPolicy,
} from "../api/queries";
import { deriveRunState, stateIsTerminal, verdictSentence, whatHappensNext } from "../lib/runState";
import { useNow } from "../lib/useNow";
import { useProgressWatch } from "../lib/useProgressWatch";
import { detectSolicitation, hasProgress, pathExplanation, progressFingerprint, walkLogText } from "../lib/walk";
import { EXECUTION_PATH_PROSE, type GoalWalkState } from "../api/types";
import { useLiveControls, useRegionFreeze } from "../state/liveControls";
import { EvidenceLedger } from "./EvidenceLedger";
import { GradeGesture } from "./GradeGesture";
import { LiveControls } from "./LiveControls";
import { SolicitationPanel } from "./SolicitationPanel";
import { StateBadge } from "./StateBadge";

function InjectContext({ dispatchId }: { dispatchId: string }): ReactNode {
  const [content, setContent] = useState("");
  const [shape, setShape] = useState("human_context");
  const mutation = useInjectContext();

  return (
    <details>
      <summary>Push context into this run while it is still going</summary>
      <div style={{ marginTop: "var(--sf-space-2)" }}>
        <p className="sf-note sf-muted">
          Confabulation is downstream of information starvation, not model weakness. If the walk is
          missing a fact, giving it the fact is cheaper and more likely to work than re-dispatching
          the same goal and hoping.
        </p>
        <label className="sf-label" htmlFor="sf-inject-shape">
          As shape
        </label>
        <input
          id="sf-inject-shape"
          className="sf-input"
          value={shape}
          onChange={(e) => setShape(e.target.value)}
        />
        <label className="sf-label" htmlFor="sf-inject-content">
          Content
        </label>
        <textarea
          id="sf-inject-content"
          className="sf-textarea"
          style={{ minHeight: "4.5rem", fontSize: "var(--sf-text-base)" }}
          value={content}
          onChange={(e) => setContent(e.target.value)}
        />
        <button
          type="button"
          className="sf-button"
          style={{ marginTop: "var(--sf-space-2)" }}
          disabled={mutation.isPending || content.trim().length === 0 || shape.trim().length === 0}
          onClick={() => mutation.mutate({ dispatchId, shape: shape.trim(), content: content.trim() })}
        >
          {mutation.isPending ? "Pushing…" : "Push into the pool"}
        </button>
        {mutation.isError ? (
          <p className="sf-error">
            Not accepted: {(mutation.error as Error).message}. A run that is no longer running will
            refuse this — that is a real answer, not a fault.
          </p>
        ) : null}
        {mutation.isSuccess ? <p className="sf-ok">In the pool. The walk will drain it on its next iteration.</p> : null}
      </div>
    </details>
  );
}

function MachineRecord({ walk }: { walk: GoalWalkState }): ReactNode {
  // The one place `status` is rendered, and it is rendered BESIDE `reached`,
  // de-emphasised, below the verdict, and labelled as a machine record — never
  // in the position a reader scans for an outcome.
  return (
    <p className="sf-machine-record">
      machine record · status={walk.status} · reached={String(walk.reached)}
      {walk.executionPath ? ` · path=${walk.executionPath}` : ""}
      {walk.executionId ? ` · execution=${walk.executionId}` : " · execution=<none recorded>"}
      {walk.selectedTemplateId ? ` · template=${walk.selectedTemplateId}` : ""}
      {typeof walk.attemptCount === "number" ? ` · attempts=${walk.attemptCount}` : ""}
      {walk.grounded !== null ? ` · grounded=${String(walk.grounded)}` : ""}
    </p>
  );
}

export function DetailPanel({ dispatchId }: { dispatchId: string | null }): ReactNode {
  const { paused, intervalMs } = useLiveControls();
  const { frozen, handlers } = useRegionFreeze();
  const now = useNow(paused);
  const query = useWalk(dispatchId, { enabled: !paused && !frozen, intervalMs });
  // Rendering behaviour, re-read on the same cadence and frozen by the same
  // controls — a policy change must not move the surface under a reader who
  // has deliberately paused it.
  const renderPolicy = useRenderPolicy({ enabled: !paused && !frozen, intervalMs }).data;
  const walk = query.data;

  const fingerprint = walk ? progressFingerprint(walk) : "";
  const quietForMs = useProgressWatch(fingerprint, now);

  if (!dispatchId) {
    return (
      <section className="sf-region" aria-labelledby="sf-detail-title" {...handlers}>
        <div className="sf-region-head">
          <h2 className="sf-region-title" id="sf-detail-title">
            Detail
          </h2>
        </div>
        <div className="sf-region-body">
          <p className="sf-empty">
            Open a run to see what it was asked, what happened, and what it actually produced.
          </p>
        </div>
      </section>
    );
  }

  const solicitation = walk ? detectSolicitation(walk) : null;
  const terminal = walk ? walk.status !== "running" : false;

  const state: RunState = walk
    ? deriveRunState({
        status: walk.status,
        reached: walk.reached,
        awaitingAnswer: solicitation !== null,
        hasProgress: hasProgress(walk),
        quietForMs: terminal ? null : quietForMs,
      })
    : "accepted";

  const sentence = walk
    ? verdictSentence({
        state,
        status: walk.status,
        reached: walk.reached,
        goalReachReason: walk.goalReachReason,
        ...(walk.error !== undefined ? { error: walk.error } : {}),
        humanGraded: walk.humanGraded,
      })
    : "";

  const isTerminalState = stateIsTerminal(state);
  const explanation = walk && !isTerminalState ? null : walk ? pathExplanation(walk) : null;

  return (
    <section className="sf-region" aria-labelledby="sf-detail-title" {...handlers}>
      <div className="sf-region-head">
        <h2 className="sf-region-title" id="sf-detail-title">
          Detail
        </h2>
        <LiveControls frozen={frozen} regionName="detail" />
      </div>

      <div className="sf-region-body" aria-busy={query.isFetching}>
        {query.isError ? (
          <p className="sf-error">
            This run could not be read: {(query.error as Error).message}. That is this surface
            failing, and it says nothing about whether the run itself is fine.
          </p>
        ) : null}

        {!walk ? (
          <p className="sf-empty">Reading {dispatchId}…</p>
        ) : (
          <>
            {/* ── 1. what was asked ─────────────────────────────────────── */}
            <div className="sf-detail-part">
              <p className="sf-label">What was asked</p>
              {walk.goal ? (
                <p className="sf-detail-goal">{walk.goal}</p>
              ) : (
                <p className="sf-detail-goal sf-muted">
                  The goal text was not recorded on this dispatch. The run happened; what was asked
                  for is gone.
                </p>
              )}
              <p className="sf-note sf-muted" style={{ marginTop: "var(--sf-space-2)" }}>
                <span className="sf-mono">{walk.dispatchId}</span>
                {walk.operator ? ` · asked by ${walk.operator}` : ""}
                {walk.trigger ? ` · triggered by ${walk.trigger}` : ""}
                {walk.requeueOf ? ` · a requeue of ${walk.requeueOf}` : ""}
              </p>
            </div>

            {/* ── 2. what happened ──────────────────────────────────────── */}
            <div className="sf-detail-part">
              <p className="sf-label">What happened</p>
              <div style={{ marginTop: "var(--sf-space-2)" }}>
                <StateBadge state={state} />
              </div>
              <p className="sf-verdict-sentence">{sentence}</p>
              {walk.humanGraded ? (
                <p className="sf-note">
                  A human overrode the machine verdict on this run
                  {walk.humanReachNotes ? `: “${walk.humanReachNotes}”` : "."}
                </p>
              ) : null}
              {walk.executionPath ? (
                <p className="sf-note">
                  It {EXECUTION_PATH_PROSE[walk.executionPath]}
                  {explanation ? ` — ${explanation}` : ""}.
                </p>
              ) : null}
              <MachineRecord walk={walk} />
              {solicitation ? <SolicitationPanel solicitation={solicitation} /> : null}
            </div>

            {/* ── 3. what it produced ───────────────────────────────────── */}
            <div className="sf-detail-part">
              <p className="sf-label">What it produced</p>
              <p className="sf-note sf-muted">
                Every impulse the walk put in the pool, mirrored regardless of outcome. This is the
                evidence — a shape name and a character count are not. When a path did not retain
                provenance, what it DID produce is still shown, labelled as such.
              </p>

              <EvidenceLedger
                formByShape={renderPolicy?.formByShape}
                provenance={walk.poolProvenance}
                completionShapes={walk.completionShapes}
                answerBody={walk.answerBody}
                goal={walk.goal}
                selectedTemplateId={walk.selectedTemplateId}
                executionPath={walk.executionPath}
              />

              {walk.poolShapes.length > 0 ? (
                <details style={{ marginTop: "var(--sf-space-2)" }}>
                  <summary>{walk.poolShapes.length} shapes in the pool</summary>
                  <ul className="sf-shape-list">
                    {walk.poolShapes.map((shape, i) => (
                      <li key={`${shape}-${i}`} className="sf-shape-badge">
                        {shape}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}

              {/* Collapsed: offered where it repairs, not sprayed everywhere. */}
              {walk.walkLog.length > 0 ? (
                <details style={{ marginTop: "var(--sf-space-2)" }}>
                  <summary>The walk log — the last {walk.walkLog.length} lines</summary>
                  <div className="sf-walklog">
                    <ol>
                      {walk.walkLog.map((entry, i) => (
                        // @interaction:exempt P4 — walk log is an append-only text stream; line order is the only identity it has
                        <li key={`log-${i}`}>{walkLogText(entry)}</li>
                      ))}
                    </ol>
                  </div>
                </details>
              ) : (
                <p className="sf-note sf-muted" style={{ marginTop: "var(--sf-space-2)" }}>
                  The walk recorded no log lines at all.
                </p>
              )}
            </div>

            {/* ── 4. what happens next ──────────────────────────────────── */}
            <div className="sf-detail-part">
              <p className="sf-label">What happens next</p>
              <p className="sf-note">{whatHappensNext(state, walk.status === "running")}</p>

              {walk.status === "running" ? <InjectContext dispatchId={walk.dispatchId} /> : null}

              {isTerminalState ? (
                <GradeGesture
                  renderedState={state === "reached" ? "reached" : "not-reached"}
                  executionId={walk.executionId}
                  goal={walk.goal ?? ""}
                  alreadyGraded={walk.humanGraded}
                  humanReachNotes={walk.humanReachNotes}
                />
              ) : null}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
