// @interaction:exempt-file P3 — the list renders an explicitly accepted snapshot; polling never splices rows into it
/**
 * The questions rail: the accepted snapshot, grouped by kind, in importance order.
 *
 * Each row is the measured element for exposure: it carries
 * `data-solicitation-id`, `data-exposure-role`, and the ranker's `data-rank` /
 * `data-rank-explanation`. A tick is reported for every accepted snapshot and
 * every time this list is put on screen — both are presentations.
 */

import { useEffect, useRef, type ReactNode } from "react";
import { reportExposureTick } from "../lib/exposure-reporter";
import { useRenderPolicy } from "../api/queries";
import { fromPanel } from "../lib/content";
import { useLiveControls } from "../state/liveControls";
import { gapTitle, questionGapId, questionRowSubject, useQuestions, type QuestionGroup } from "../state/questions";
import { planFor } from "./Rendered";
import { QUESTION_CONTENT_SHAPE } from "./QuestionView";

/** A group's fill: every ask kind shares one, each folded class has its own. */
function fillOf(group: QuestionGroup): string {
  return group.folded ? group.kind : "ask";
}

/**
 * How the questions split, drawn: one segment per group, as wide as its count, in the groups'
 * order. The group heads carry the same swatches, so they are its legend. Not a list row: it
 * is no exposure.
 */
function Split({ groups }: { groups: readonly QuestionGroup[] }): ReactNode {
  const shown = groups.filter((g) => g.count > 0);
  if (shown.length === 0) return null;
  const said = shown.map((g) => `${g.count} ${g.label.toLowerCase()}`).join(", ");
  return (
    <div className="sf-qsplit" role="img" aria-label={`Questions: ${said}.`}>
      {shown.map((g) => (
        <span key={g.kind} className="sf-qsplit-part" data-fill={fillOf(g)} style={{ flexGrow: g.count }} title={`${g.count} ${g.label}`} />
      ))}
    </div>
  );
}

export function QuestionsList({
  selectedId,
  onSelect,
}: {
  selectedId: string | null;
  onSelect: (questionId: string) => void;
}): ReactNode {
  const { query, groups, ordered, ranking, changed, acceptedTicks, accept } = useQuestions();
  const listRef = useRef<HTMLDivElement | null>(null);
  const { paused, intervalMs } = useLiveControls();
  const policy = useRenderPolicy({ enabled: !paused, intervalMs }).data;

  useEffect(() => {
    if (acceptedTicks === 0 || !listRef.current) return;
    reportExposureTick(listRef.current, ordered.length);
    // Mount is a presentation too: this list only exists while its tab is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acceptedTicks]);

  return (
    <div className="sf-rail-scroll" ref={listRef}>
      {changed ? (
        <button type="button" className="sf-new-pill" onClick={() => void accept()}>
          ↑ Updated — show
        </button>
      ) : null}
      {query.isError && ordered.length === 0 ? <p className="sf-rail-empty sf-error">Questions unavailable</p> : null}
      {query.isPending ? <p className="sf-rail-empty">Loading…</p> : null}
      {!query.isPending && ordered.length === 0 && !query.isError ? (
        <p className="sf-rail-empty">No questions</p>
      ) : null}

      <Split groups={groups} />

      {groups.map((group) => (
        <details key={group.kind} className="sf-qgroup" data-folded={group.folded} open={!group.folded}>
          <summary className="sf-qgroup-head">
            <span className="sf-qgroup-label">
              <span className="sf-qswatch" data-fill={fillOf(group)} aria-hidden="true" />
              {group.label}
            </span>
            <span className="sf-qgroup-count">{group.count}</span>
          </summary>
          {group.count > group.questions.length ? (
            <p className="sf-muted sf-qgroup-note">{group.questions.length === 0 ? "none of them in this page of questions" : `${group.questions.length} of them in this page of questions`}</p>
          ) : null}
          <ul className="sf-qgroup-list">
            {group.questions.map((question) => {
              const gapId = questionGapId(question);
              const status = question.answered ? "answered" : question.declined ? "declined" : "open";
              return (
                <li key={question.id}>
                  <button
                    type="button"
                    className="sf-qrow"
                    data-status={status}
                    data-solicitation-id={question.id}
                    data-exposure-role="list_row"
                    // The form the card draws this question's body in — the
                    // form learner's evidence, read off this row at act time.
                    data-form={planFor(fromPanel(QUESTION_CONTENT_SHAPE, question.body), policy).form}
                    data-form-shape={QUESTION_CONTENT_SHAPE}
                    {...(typeof question.rank === "number" ? { "data-rank": String(question.rank) } : {})}
                    {...(question.because?.[0] ? { "data-rank-explanation": question.because[0] } : {})}
                    aria-current={selectedId === question.id ? "true" : undefined}
                    onClick={() => onSelect(question.id)}
                  >
                    <span className="sf-qrow-subject">{questionRowSubject(question) || <span className="sf-muted">question text not recorded</span>}</span>
                    <span className="sf-qrow-meta">
                      {status !== "open" ? <span className="sf-qrow-status">{status}</span> : null}
                      {gapId && !gapTitle(gapId) ? <span className="sf-mono">{gapId}</span> : null}
                      {question.run?.linked ? <span className="sf-chip sf-chip-quiet" title={question.run.dispatchId ?? undefined}>run</span> : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </details>
      ))}

      {ranking && ranking.not_shown_count > 0 ? (
        <p className="sf-participation-slice sf-rail-foot" data-slice-source={ranking.slice_source}>
          {ranking.not_shown_count} more, less urgent, not listed
        </p>
      ) : null}
    </div>
  );
}
