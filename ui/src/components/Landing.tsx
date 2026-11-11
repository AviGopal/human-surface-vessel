/**
 * The first screen: the entries the landing's view names, in its order (src/ui-views.ts).
 * The view is read at use time, so a view the system writes redraws the landing with no
 * rebuild. The page holds no default of its own: the server's view, its default included,
 * is the only list of what to draw. The view in force is named on the page, and so is a
 * newer view that was passed over, with the reason.
 *
 * Rows here select what to look at; the only thing sent from this screen is a person's
 * verdict on a row an entry offers it on.
 */
import type { ReactNode } from "react";
import type { UiViewState } from "../api/client";
import { Entries } from "./Reports";

/** The line naming the view in force: which revision, and who wrote it. */
export function viewLine(view: UiViewState): string {
  if (view.revision === 0) return `Showing the default view (${view.id}).`;
  return `Showing view ${view.id}${view.writtenBy ? `, written by ${view.writtenBy}` : ""}.`;
}

/** Why a newer view is not drawn, in words. */
export function notDrawnLine(view: UiViewState): string | null {
  const n = view.notDrawn;
  if (!n) return null;
  return `View ${n.id} was not drawn: ${n.refusal.replace(/_/g, " ")} (${n.detail}).`;
}

export function Landing({
  view,
  viewError,
  onOpenQuestion,
  live = true,
  intervalMs = 60_000,
}: {
  view: UiViewState | undefined;
  /** Why the view could not be read, when it could not. */
  viewError?: string | null;
  onOpenQuestion: (id: string) => void;
  /** False while the page is paused: entries are not re-read. */
  live?: boolean;
  /** The page's live cadence (the render policy's); entries are re-read no faster than once a minute. */
  intervalMs?: number;
}): ReactNode {
  if (!view) {
    return (
      <div className="sf-landing">
        <p className="sf-main-empty">{viewError ? `The view could not be read: ${viewError}` : "Reading the view…"}</p>
      </div>
    );
  }
  const passed = notDrawnLine(view);
  return (
    <div className="sf-landing" data-view-id={view.id} data-view-revision={view.revision}>
      <p className="sf-muted sf-report-note" data-view-line="">
        {viewLine(view)}
      </p>
      {passed ? (
        <p className="sf-report-note" role="status" data-view-not-drawn="">
          {passed}
        </p>
      ) : null}
      <Entries entries={view.entries} enabled={live} intervalMs={intervalMs} onOpenQuestion={onOpenQuestion} />
    </div>
  );
}
