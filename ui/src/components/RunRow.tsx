/**
 * A verdict-first row (rule P1).
 *
 * The leftmost column is ALWAYS the reach verdict. `status` does not appear in
 * this row at all — not in a corner, not in a tooltip, not smaller. The whole
 * reason this surface exists is that a template exit status was occupying the
 * position a reader scans for the outcome, and a run that exits `completed`
 * with `reached: false` is the measured, dominant failure of this system.
 *
 * The row also never MOVES. Its sort key is `startedAt`, which is fixed for the
 * run's lifetime, so a run progressing from accepted to running to a verdict
 * updates its cells in place and stays exactly where the reader last saw it.
 */

import type { RunState } from "@avigopal/design-tokens";
import type { ReactNode } from "react";
import { useWalk } from "../api/queries";
import type { ActiveDispatch } from "../api/types";
import { deriveRunState, verdictSentence } from "../lib/runState";
import { formatElapsed } from "../lib/time";
import { useProgressWatch } from "../lib/useProgressWatch";
import { boardFingerprint, detectSolicitation, hasProgress, progressFingerprint } from "../lib/walk";
import { StateBadge } from "./StateBadge";

export interface RunRowProps {
  readonly row: ActiveDispatch;
  readonly startedAtMs: number;
  readonly now: number;
  readonly selected: boolean;
  /**
   * Whether this row may hold its own live walk query. The board carries too
   * few fields to tell `waiting` from `running`, so the newest handful of
   * in-flight rows read their own walk state; the rest fall back to what the
   * board gives.
   */
  readonly liveDetail: boolean;
  readonly onSelect: (dispatchId: string) => void;
  readonly intervalMs: number;
}

export function RunRow({
  row,
  startedAtMs,
  now,
  selected,
  liveDetail,
  onSelect,
  intervalMs,
}: RunRowProps): ReactNode {
  const terminal = row.status === "completed" || row.status === "failed";

  const walkQuery = useWalk(row.dispatchId, {
    enabled: liveDetail && !terminal,
    intervalMs,
  });
  const walk = walkQuery.data;

  const fingerprint = walk ? progressFingerprint(walk) : boardFingerprint(row);
  const quietForMs = useProgressWatch(fingerprint, now);
  const solicitation = walk ? detectSolicitation(walk) : null;

  const state: RunState = deriveRunState({
    status: row.status,
    reached: row.reached,
    awaitingAnswer: solicitation !== null,
    hasProgress: walk ? hasProgress(walk) : Boolean(row.executionId ?? row.selectedTemplateId),
    quietForMs: terminal ? null : quietForMs,
  });

  const reason = verdictSentence({
    state,
    status: row.status,
    reached: row.reached,
    goalReachReason: walk?.goalReachReason ?? null,
    ...(walk?.error !== undefined ? { error: walk.error } : {}),
    humanGraded: walk?.humanGraded ?? false,
  });

  const goalText = row.goal?.trim();

  return (
    <button
      type="button"
      className="sf-run-row"
      data-selected={selected}
      data-state={state}
      onClick={() => onSelect(row.dispatchId)}
      aria-current={selected ? "true" : undefined}
    >
      {/* 1. the verdict, first, always */}
      <StateBadge state={state} />

      {/* 2. what was asked */}
      <span className="sf-run-goal" data-missing={goalText ? "false" : "true"} title={goalText ?? ""}>
        {goalText ?? "goal text not recorded on this dispatch"}
      </span>

      {/* 3. elapsed — updates in place, never a sort key */}
      <span className="sf-run-elapsed">{formatElapsed(now - startedAtMs)}</span>

      {/* 4. attribution */}
      <span className="sf-run-meta">
        {row.operator ?? row.trigger ?? "unattributed"}
      </span>

      {/* The reason, on the rows where it repairs something: a failure, a
          question, or a run that has gone quiet. Explanation sprayed across
          successes manufactures over-reliance. */}
      {state === "not-reached" || state === "waiting" || state === "stalled" ? (
        <span className="sf-run-reason">
          {state === "waiting" && solicitation
            ? `Waiting on you — ${solicitation.evidenceLine.slice(0, 160)}`
            : reason}
        </span>
      ) : null}
    </button>
  );
}
