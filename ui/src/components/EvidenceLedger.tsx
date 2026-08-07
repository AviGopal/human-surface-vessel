/**
 * THE EVIDENCE LEDGER — rule P8.
 *
 * The output of a walk is not "an artifact". It is the set of shaped impulses
 * the walk accumulated in the pool, mirrored onto the dispatch record
 * regardless of outcome — which is the whole point, because judging a reach
 * verdict requires seeing what was actually produced, and a failed walk's
 * outputs are exactly as worth inspecting as a reached one's.
 *
 * So every entry shows THE CONTENT ITSELF. Length, truncation, and identifiers
 * ride alongside it and appear BELOW it in source order. A character count is
 * not evidence — and a shape name, a length, and a trace id are all things this
 * surface could print without ever having looked at the output.
 *
 * ── WHY THERE IS A FALLBACK CHAIN ─────────────────────────────────────────
 *
 * Measured on a live run: a goal that genuinely reached, with a correct answer
 * in `answerBody`, arrived with `poolProvenance: []` and `poolShapes: []`. The
 * walk log said why — `REUSE-BEFORE-DERIVE — the store recommends the floor for
 * this goal (6/6 reached); running it directly and skipping the walk`. The
 * ReAct floor (`executionPath: universal_tool_fallback`) never populates the
 * pool, and the floor is a large share of all execution.
 *
 * A ledger that renders only `poolProvenance` would therefore accuse a correct
 * run of having produced nothing. That is the mirror image of the receipt
 * problem this component exists to fix: instead of a receipt where content
 * belongs, an empty state where content exists. Both are the surface lying
 * about evidence.
 *
 * Hence: pool first, then `answerBody`, then `completionShapes`, and only with
 * all three empty does the ledger say there is nothing. Each tier is LABELLED
 * with what it is, because "we have the content" and "we have the content and
 * we know which step produced it" are different claims and blurring them is
 * exactly what this surface must not do.
 */

import type { ReactNode } from "react";
import { detectForm, normalizeLedger, PREVIEW_CAP, type LedgerEntry } from "../lib/ledger";
import { formatChars } from "../lib/time";
import { describesFilesystem, extractPaths } from "../lib/tree";
import type { ExecutionPath, RawProvenance } from "../api/types";
import { ContentRender } from "./ContentRender";
import { Prose } from "./Prose";

function EntryHead({ entry }: { entry: LedgerEntry }): ReactNode {
  return (
    <div className="sf-ledger-head">
      <span className="sf-shape-badge">{entry.shape}</span>
      <span className="sf-note">
        {entry.producedBy ? (
          <>
            produced by <span className="sf-mono">{entry.producedBy}</span>
          </>
        ) : (
          <span className="sf-muted">no producer recorded</span>
        )}
      </span>
      {entry.goalSignature ? (
        <span className="sf-muted sf-mono" style={{ fontSize: "var(--sf-text-xs)" }}>
          {entry.goalSignature}
        </span>
      ) : null}
    </div>
  );
}

function Entry({
  entry,
  formByShape,
}: {
  entry: LedgerEntry;
  /** The `renderPolicy` override, read at use time. Undefined = heuristic. */
  formByShape?: Readonly<Record<string, string>>;
}): ReactNode {
  if (entry.kind === "empty") {
    // NAME the emptiness. An empty impulse proves a step RAN; it does not
    // prove the step produced anything, and silently rendering nothing here
    // lets a reader count it as output.
    return (
      <article className="sf-ledger-entry">
        <EntryHead entry={entry} />
        <p className="sf-ledger-empty">
          Empty — carries the shape but no content. This proves a step ran, not that it produced
          anything.
        </p>
      </article>
    );
  }

  const form = detectForm(entry.shape, entry.preview, formByShape);

  return (
    <article className="sf-ledger-entry">
      <EntryHead entry={entry} />

      {/* The content, first and always. */}
      <div className="sf-ledger-body">
        <ContentRender form={form} text={entry.preview} />
      </div>

      {/* Length rides alongside — below, never instead. */}
      <div className="sf-ledger-foot">
        {entry.truncated ? (
          <>
            Showing the first {formatChars(Math.min(entry.preview.length, PREVIEW_CAP))} of{" "}
            {formatChars(entry.chars)} characters — this is a preview, not the output. The full
            content is in the trace.
          </>
        ) : (
          <>
            {formatChars(entry.chars)} characters, rendered in full · read as{" "}
            <span className="sf-mono">{form}</span>
          </>
        )}
      </div>
    </article>
  );
}

/** Tier 1 of the fallback: real content, without per-impulse provenance. */
function AnswerEntry({
  answerBody,
  producedBy,
  provenanceRetained,
}: {
  answerBody: string;
  producedBy: string | undefined;
  provenanceRetained: boolean;
}): ReactNode {
  return (
    <article className="sf-ledger-entry">
      <div className="sf-ledger-head">
        <span className="sf-shape-badge">goal_answer</span>
        <span className="sf-note">
          {producedBy ? (
            <>
              produced by <span className="sf-mono">{producedBy}</span>
            </>
          ) : (
            <span className="sf-muted">no producing template recorded</span>
          )}
        </span>
        <span className="sf-note sf-muted">
          {provenanceRetained
            ? "the answer rendered for a human — one impulse among those below, not the output itself"
            : "recovered from the run's answer, not from the pool"}
        </span>
      </div>
      <div className="sf-ledger-body">
        <Prose source={answerBody} />
      </div>
      <div className="sf-ledger-foot">
        {formatChars(answerBody.length)} characters, rendered in full
      </div>
    </article>
  );
}

function TreeNote({
  goal,
  answerBody,
  provenanceText,
}: {
  goal: string | undefined;
  answerBody: string | null;
  provenanceText: string;
}): ReactNode {
  if (!describesFilesystem(goal, answerBody)) return null;
  const { paths } = extractPaths([answerBody, provenanceText, goal]);
  return (
    <p className="sf-note sf-muted" style={{ marginTop: "var(--sf-space-2)" }}>
      This answer describes a filesystem, and the substrate reads ITS OWN working tree — not the
      checkout on your machine.
      {paths.length > 0 ? (
        <>
          {" "}
          The run named{" "}
          {paths.map((p, i) => (
            <span key={p}>
              {i > 0 ? ", " : ""}
              <span className="sf-mono">{p}</span>
            </span>
          ))}
          .
        </>
      ) : (
        " The run did not record which path it read, so none is shown here."
      )}{" "}
      A number that disagrees with your local copy is not necessarily wrong — both can be correct
      about their own tree.
    </p>
  );
}

export function EvidenceLedger({
  formByShape,
  provenance,
  completionShapes,
  answerBody,
  goal,
  selectedTemplateId,
  executionPath,
}: {
  /** `renderPolicy.formByShape`, threaded from the live query. */
  formByShape?: Readonly<Record<string, string>>;
  provenance: readonly RawProvenance[];
  completionShapes: readonly string[] | null;
  answerBody: string | null;
  goal: string | undefined;
  selectedTemplateId: string | undefined;
  executionPath: ExecutionPath | null;
}): ReactNode {
  const entries = normalizeLedger(provenance);
  const provenanceText = entries
    .map((e) => (e.kind === "content" ? e.preview : ""))
    .join("\n")
    .slice(0, 8000);

  /* ── the pool has content: the normal, fully-attributed case ───────────── */
  if (entries.length > 0) {
    const covering = new Set(completionShapes ?? []);
    const emptyCount = entries.filter((e) => e.kind === "empty").length;

    return (
      <div>
        <p className="sf-note">
          {entries.length} impulse{entries.length === 1 ? "" : "s"} in the pool
          {emptyCount > 0 ? `, of which ${emptyCount} carry no content` : ""}
          {covering.size > 0
            ? ` · ${[...covering].join(", ")} covered the goal's target shapes`
            : " · none of them was recorded as covering the goal's target shapes"}
          .
        </p>
        {answerBody ? (
          <AnswerEntry
            answerBody={answerBody}
            producedBy={selectedTemplateId}
            provenanceRetained
          />
        ) : null}
        {entries.map((entry, i) => (
          // Provenance entries have no id of their own; shape plus position is
          // the stable identity available, and the ledger is replaced wholesale
          // on each poll rather than reconciled row by row.
          <Entry key={`${entry.shape}-${i}`} entry={entry} formByShape={formByShape} />
        ))}
        <TreeNote goal={goal} answerBody={answerBody} provenanceText={provenanceText} />
      </div>
    );
  }

  const pathNote =
    executionPath === "universal_tool_fallback"
      ? "This run went down the general tool loop, which executes without accumulating impulses in the pool — so there is no per-impulse provenance to show. That is a property of the path taken, not a sign the run produced nothing."
      : "This execution path did not retain per-impulse provenance — the content below is real, but which step produced it was not recorded.";

  /* ── tier 1: the answer itself ─────────────────────────────────────────── */
  if (answerBody && answerBody.trim().length > 0) {
    return (
      <div>
        <p className="sf-warn">{pathNote}</p>
        <AnswerEntry
          answerBody={answerBody}
          producedBy={selectedTemplateId}
          provenanceRetained={false}
        />
        <TreeNote goal={goal} answerBody={answerBody} provenanceText="" />
      </div>
    );
  }

  /* ── tier 2: the shapes are known, their content is not ────────────────── */
  if (completionShapes && completionShapes.length > 0) {
    return (
      <div>
        <p className="sf-warn">{pathNote}</p>
        <p className="sf-note">
          The run recorded which shapes covered the goal, but this execution path did not retain
          their content. These are the shapes — and a shape name is NOT the output. Nothing here
          lets you check what was actually produced; the trace is the only place that can.
        </p>
        <ul className="sf-shape-list">
          {completionShapes.map((shape, i) => (
            <li key={`${shape}-${i}`} className="sf-shape-badge">
              {shape}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  /* ── tier 3: genuinely nothing ─────────────────────────────────────────── */
  return (
    <p className="sf-warn">
      Nothing at all: no impulses in the pool, no answer, and no covering shapes. There is nothing
      here to judge — a run that reaches on an empty ledger reached on something this surface cannot
      show you, and a verdict you cannot check is not evidence.
    </p>
  );
}
