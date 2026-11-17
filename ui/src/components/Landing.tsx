/**
 * The first screen: the entries the landing's view names, in its order (src/ui-views.ts).
 * The view is read at use time, so a view the system writes redraws the landing with no
 * rebuild. The page holds no default of its own: the server's view, its default included,
 * is the only list of what to draw. Which view is in force, and a newer view that was passed
 * over with its reason, is a mark beside the landing, opened by hover or tap: mechanism, so
 * not a line of the page (surface-acts-on-shapes-present R.3). A passed-over view still shows:
 * its mark differs, so a fallback is never silent. The mark says which layout in plain words,
 * naming no part of the system (the USER 11-16, by research); under them, the view's id, writer
 * and any refusal as records name them. The full refusal stays readable in `human_surface:ui_view`.
 *
 * Rows here select what to look at. What is sent from this screen is a person's verdict on a
 * row an entry offers it on, and an answer to a question opened in place.
 */
import type { ReactNode } from "react";
import type { UiViewState } from "../api/client";
import { Entries } from "./Reports";
import { QuestionView } from "./QuestionView";

/** Which layout is in force, in plain words: the usual one (its default, a return to it, or a view that draws just what it does), or one rearranged since. */
export function viewLine(view: UiViewState): string {
  return view.revision === 0 || view.isDefault === true || view.drawsDefault === true ? "My usual layout." : "A rearranged layout.";
}

/** The view in force as records name it: its id and its writer, as written. */
export function viewRecord(view: UiViewState): string {
  return view.writtenBy ? `${view.id} · ${view.writtenBy}` : view.id;
}

/** That a newer view is not drawn, in plain words; its id and refusal as written are its record. */
export function notDrawnLine(view: UiViewState): string | null {
  return view.notDrawn ? "A newer layout was not used." : null;
}

/** The passed-over view as records name it: its id, refusal and detail, as written. */
export function notDrawnRecord(view: UiViewState): string | null {
  const n = view.notDrawn;
  return n ? `${n.id} · ${n.refusal}: ${n.detail}` : null;
}

export function Landing({
  view,
  viewError,
  onOpenQuestion,
  openQuestion = null,
  live = true,
  intervalMs = 60_000,
}: {
  view: UiViewState | undefined;
  /** Why the view could not be read, when it could not. */
  viewError?: string | null;
  /** Opens a question in place on the landing, or closes it when it is the open one. */
  onOpenQuestion: (id: string) => void;
  /** The question open in place, if any. */
  openQuestion?: string | null;
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
  // A view that lists no questions still shows one opened by a link, above its entries.
  const listsQuestions = view.entries.some((e) => e.form === "questions");
  const about = passed ? "A newer layout for this page was not used" : "About this page's layout";
  return (
    <div className="sf-landing" data-view-id={view.id} data-view-revision={view.revision}>
      <details className="sf-mark" data-fell-back={passed ? "" : undefined}>
        <summary aria-label={about} title={passed ? `${viewLine(view)} ${passed}` : viewLine(view)}>
          {passed ? "!" : "i"}
        </summary>
        <div className="sf-mark-body">
          <p className="sf-report-note" data-view-line="">
            {viewLine(view)}
          </p>
          <p className="sf-report-note sf-view-record" data-view-record="">
            {viewRecord(view)}
          </p>
          {passed ? (
            <>
              <p className="sf-report-note" data-view-not-drawn="">
                {passed}
              </p>
              <p className="sf-report-note sf-view-record" data-view-not-drawn-record="">
                {notDrawnRecord(view)}
              </p>
            </>
          ) : null}
        </div>
      </details>
      {openQuestion !== null && !listsQuestions ? (
        <div className="sf-question-inplace" data-question-open={openQuestion}>
          <QuestionView questionId={openQuestion} />
        </div>
      ) : null}
      <Entries entries={view.entries} readers={view.readers} faces={view.faces} enabled={live} intervalMs={intervalMs} onOpenQuestion={onOpenQuestion} openQuestion={openQuestion} />
    </div>
  );
}
