/**
 * The first screen: the blocks the landing's view names, in its order (src/ui-views.ts).
 * The view is read at use time, so a view the system writes redraws the landing with no
 * rebuild. A block with nothing to show is left out. With no view, or one naming blocks
 * this build cannot draw, the landing draws its default: the newest own run.
 *
 * Rows here select what to look at; nothing on this screen sends anything.
 */
import type { ReactNode } from "react";
import type { UiViewState } from "../api/client";
import type { GapThreadView } from "../api/client";
import type { Question } from "../api/participation";
import type { ActiveDispatch } from "../api/types";
import { classifyQuestion } from "../lib/questionClass";
import { deriveRunState } from "../lib/runState";
import { questionRowSubject } from "../state/questions";
import { isMine } from "./RunsList";
import { RunView } from "./RunView";
import { StateBadge } from "./StateBadge";

export const LANDING_BLOCKS = ["needs_you", "changed", "health", "latest_run"] as const;
export type LandingBlock = (typeof LANDING_BLOCKS)[number];
export const DEFAULT_LANDING: { blocks: readonly LandingBlock[]; limits: Record<string, number> } = { blocks: ["latest_run"], limits: {} };

/** How many decisions "Needs you" lists when the view sets no limit. */
const NEEDS_YOU_DEFAULT = 5;
/** How many of the person's runs "Your threads" lists. */
const CHANGED_SHOWN = 5;

/** The blocks to draw: the view's when every block is one this build draws, else the default. */
export function landingBlocks(view: UiViewState | undefined): { blocks: readonly LandingBlock[]; limits: Readonly<Record<string, number>>; fromView: boolean } {
  if (!view || view.blocks.length === 0 || !view.blocks.every((b): b is LandingBlock => (LANDING_BLOCKS as readonly string[]).includes(b))) {
    return { ...DEFAULT_LANDING, fromView: false };
  }
  return { blocks: view.blocks as readonly LandingBlock[], limits: view.limits, fromView: true };
}

/** Open asks, in the order the system ranked them. */
export function needsYou(ordered: readonly Question[], limit: number): readonly Question[] {
  return ordered.filter((q) => !q.answered && !q.declined && classifyQuestion(q) === "ask").slice(0, limit);
}

/** The person's own finished runs whose outcome is known, newest first. */
export function yourThreads(rows: readonly ActiveDispatch[] | undefined, limit: number): readonly ActiveDispatch[] {
  return (rows ?? [])
    .filter((r) => isMine(r) && r.status !== "gone")
    .slice()
    .sort((a, b) => String(b.startedAt ?? "").localeCompare(String(a.startedAt ?? "")))
    .slice(0, limit);
}

/** The open gap with the most attempts and none landed: what the system is stuck on. */
export function stuckOn(threads: readonly GapThreadView[] | undefined): GapThreadView | null {
  let best: GapThreadView | null = null;
  for (const t of threads ?? []) {
    if (t.status === "closed" || t.landedCount > 0) continue;
    if (!best || t.attemptCount > best.attemptCount) best = t;
  }
  return best;
}

export function Landing({
  view,
  ordered,
  board,
  gapThreads,
  latest,
  onOpenRun,
  onOpenQuestion,
  onOpenSystem,
}: {
  view: UiViewState | undefined;
  ordered: readonly Question[];
  board: readonly ActiveDispatch[] | undefined;
  gapThreads: readonly GapThreadView[] | undefined;
  latest: string | null;
  onOpenRun: (dispatchId: string) => void;
  onOpenQuestion: (id: string) => void;
  onOpenSystem: () => void;
}): ReactNode {
  const { blocks, limits, fromView } = landingBlocks(view);
  const drawn: ReactNode[] = [];
  for (const block of blocks) {
    if (block === "needs_you") {
      const items = needsYou(ordered, limits["needs_you"] ?? NEEDS_YOU_DEFAULT);
      if (items.length === 0) continue;
      drawn.push(
        <section key={block} className="sf-landing-block" data-block={block} aria-labelledby="sf-landing-needs">
          <h2 id="sf-landing-needs" className="sf-landing-head">Needs you</h2>
          <ul className="sf-landing-list">
            {items.map((q) => (
              <li key={q.id}>
                <button type="button" className="sf-landing-row" onClick={() => onOpenQuestion(q.id)}>
                  {questionRowSubject(q) || <span className="sf-muted">question text not recorded</span>}
                </button>
              </li>
            ))}
          </ul>
        </section>,
      );
    } else if (block === "changed") {
      const items = yourThreads(board, CHANGED_SHOWN);
      if (items.length === 0) continue;
      drawn.push(
        <section key={block} className="sf-landing-block" data-block={block} aria-labelledby="sf-landing-changed">
          <h2 id="sf-landing-changed" className="sf-landing-head">Your threads</h2>
          <ul className="sf-landing-list">
            {items.map((r) => (
              <li key={r.dispatchId}>
                <button type="button" className="sf-landing-row" onClick={() => onOpenRun(r.dispatchId)}>
                  <StateBadge state={deriveRunState({ status: r.status, reached: r.reached, awaitingAnswer: false, hasProgress: true, quietForMs: null, acceptedForMs: null })} />
                  <span>{r.goal ?? r.dispatchId}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>,
      );
    } else if (block === "health") {
      // Finished runs whose outcome is known: a running run has none yet, a gone one has lost it.
      const runs = (board ?? []).filter((r) => r.status === "completed" || r.status === "failed");
      if (runs.length === 0) continue;
      const reached = runs.filter((r) => r.reached === true).length;
      const stuck = stuckOn(gapThreads);
      drawn.push(
        <section key={block} className="sf-landing-block" data-block={block} aria-label="The system">
          <button type="button" className="sf-landing-health" onClick={onOpenSystem}>
            <span className="sf-landing-num">{reached} / {runs.length}</span>
            <span>reached</span>
            {stuck ? <span className="sf-landing-stuck">stuck: {stuck.summary ?? stuck.gapId} · {stuck.attemptCount} attempts</span> : null}
          </button>
        </section>,
      );
    } else if (block === "latest_run") {
      if (!latest) continue;
      drawn.push(
        <div key={block} className="sf-landing-run" data-block={block}>
          <RunView key={latest} dispatchId={latest} />
        </div>,
      );
    }
  }
  return (
    <div className="sf-landing" data-view-id={fromView && view ? view.id : `landing@0`} data-view-revision={fromView && view ? view.revision : 0} data-view-default={fromView ? undefined : "true"}>
      {drawn.length > 0 ? drawn : <p className="sf-main-empty">Select a run or a question</p>}
    </div>
  );
}
