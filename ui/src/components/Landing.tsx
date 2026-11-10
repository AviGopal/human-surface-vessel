/**
 * The first screen: the blocks the landing's view names, in its order (src/ui-views.ts).
 * The view is read at use time, so a view the system writes redraws the landing with no
 * rebuild. A block with nothing to show is left out. With no view, or one naming blocks
 * this build cannot draw, the landing draws its default: open questions. The server's
 * own default view (src/ui-views.ts) adds the reports it names.
 *
 * Rows here select what to look at; nothing on this screen sends anything.
 */
import type { ReactNode } from "react";
import type { UiViewState } from "../api/client";
import type { Question } from "../api/participation";
import { classifyQuestion } from "../lib/questionClass";
import { questionRowSubject } from "../state/questions";
import { Reports } from "./Reports";

export const LANDING_BLOCKS = ["needs_you", "reports"] as const;
export type LandingBlock = (typeof LANDING_BLOCKS)[number];
/** With no view read, nothing names a report, so the default is what the page holds itself. */
export const DEFAULT_LANDING: { blocks: readonly LandingBlock[]; limits: Record<string, number> } = { blocks: ["needs_you"], limits: {} };

/** How many decisions "Needs you" lists when the view sets no limit. */
const NEEDS_YOU_DEFAULT = 5;

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

export function Landing({
  view,
  ordered,
  onOpenQuestion,
  live = true,
}: {
  view: UiViewState | undefined;
  ordered: readonly Question[];
  onOpenQuestion: (id: string) => void;
  /** False while the page is paused: reports are not re-read. */
  live?: boolean;
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
                  <span className="sf-landing-text">{questionRowSubject(q) || <span className="sf-muted">question text not recorded</span>}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>,
      );
    } else if (block === "reports") {
      const pointers = fromView && view ? (view.reports ?? []) : [];
      if (pointers.length === 0) continue;
      drawn.push(
        <section key={block} className="sf-landing-block" data-block={block} aria-labelledby="sf-landing-reports">
          <h2 id="sf-landing-reports" className="sf-landing-head">The system</h2>
          <Reports pointers={pointers} enabled={live} />
        </section>,
      );
    }
  }
  return (
    <div className="sf-landing" data-view-id={fromView && view ? view.id : `landing@0`} data-view-revision={fromView && view ? view.revision : 0} data-view-default={fromView ? undefined : "true"}>
      {drawn.length > 0 ? drawn : <p className="sf-main-empty">Nothing to show yet</p>}
    </div>
  );
}
