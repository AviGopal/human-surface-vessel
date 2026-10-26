/**
 * The surface's self-report, in the shape the substrate's own legibility
 * detector already knows how to read.
 *
 * `ui_legibility_scan` (development-vessel) reads a panel's EFFECTIVE token
 * values and component counts and judges them against computable rules. It was
 * written against obsidian-vessel, but it takes its target endpoint as a pointer
 * parameter, so any surface that answers `obsidian:ui_view` can be audited by
 * it. This module is that answer for the human surface.
 *
 * The values below are the REAL effective values this surface renders with —
 * they are the same numbers `@avigopal/design-tokens` emits. Exposing them under
 * the `--sub-font-*` names the detector reads is an adapter, not a fabrication:
 * the detector forms a genuine judgment about genuine values.
 *
 * That is the point of an effect-reading validator. It cannot be fooled by how
 * the surface is factored, only by what it actually renders.
 */

import { buildFormCensus, type FormCensus } from "./form-census.ts";
import { VIEW_REGIONS, currentView, type ViewRegion } from "./ui-views.ts";
import { emptyRefusals } from "./write-refusals.ts";
import { aggregateByKind, readExposureCorpus } from "./importance-learn.ts";
import { isSolicitation } from "./solicitation.ts";
import { listPanels, questionView } from "./store.ts";
import { answerReaderFor, classifyQuestion, malformedReason, type ClassifiableQuestion, type QuestionClass } from "./question-class.ts";

/** One kind of question, as a person meets it here, and what people have done with it. */
export interface AskKindView {
  readonly kind: string;
  readonly count: number;
  /** Not answered and not declined. */
  readonly open: number;
  /** How the rail presents them (ui/src/lib/questionClass): `ask` leads; the rest are folded. */
  readonly presented_as: Partial<Record<QuestionClass, number>>;
  /** Which reader takes the answers (ui/src/lib/disposition), by panel count. `unknown`: none this surface knows of. */
  readonly answer_readers: Record<string, number>;
  /** From the exposure corpus (importance-learn aggregateByKind): distinct panels. Null when no outcome is recorded. */
  readonly outcomes: { answered: number; declined: number; ignored: number; complained: number } | null;
}

export interface AsksView {
  readonly total: number;
  /** What the "Questions" count shows: open questions presented as asks. */
  readonly open_asks: number;
  readonly by_kind: readonly AskKindView[];
  /** Up to five, newest first: what a writer sent that gives a person nothing to act on. */
  readonly malformed: readonly { id: string; kind: string; title: string; reason: string }[];
}

/**
 * What the questions rail holds right now and how people have responded, per
 * kind: the part of this report a question WRITER can read before it writes.
 */
export function buildAsksView(malformedLimit = 5): AsksView {
  const panels = listPanels().filter((pn) => isSolicitation(pn)).map(questionView) as unknown as (ClassifiableQuestion & { kind?: string; answered: boolean; declined: boolean; createdAt: number })[];
  const evidence = new Map(aggregateByKind(readExposureCorpus()).evidence.map((e) => [e.kind, e] as const));
  const byKind = new Map<string, { count: number; open: number; presented_as: Partial<Record<QuestionClass, number>>; answer_readers: Record<string, number> }>();
  let openAsks = 0;
  const malformed: { id: string; kind: string; title: string; reason: string; at: number }[] = [];
  for (const q of panels) {
    const kind = q.kind ?? "question";
    const row = byKind.get(kind) ?? { count: 0, open: 0, presented_as: {}, answer_readers: {} };
    const cls = classifyQuestion(q);
    const open = !q.answered && !q.declined;
    row.count += 1;
    if (open) row.open += 1;
    row.presented_as[cls] = (row.presented_as[cls] ?? 0) + 1;
    const reader = answerReaderFor(q.id);
    row.answer_readers[reader] = (row.answer_readers[reader] ?? 0) + 1;
    byKind.set(kind, row);
    if (open && cls === "ask") openAsks += 1;
    const why = malformedReason(q);
    if (why) malformed.push({ id: q.id, kind, title: q.title, reason: why, at: q.createdAt });
  }
  return {
    total: panels.length,
    open_asks: openAsks,
    by_kind: [...byKind.entries()]
      .map(([kind, r]) => {
        const e = evidence.get(kind);
        return {
          kind,
          ...r,
          outcomes: e
            ? { answered: e.answeredPanels, declined: e.declinedPanels, ignored: e.ignoredPanels, complained: e.complainedPanels }
            : null,
        };
      })
      .sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind)),
    malformed: malformed
      .sort((a, b) => b.at - a.at || a.id.localeCompare(b.id))
      .slice(0, malformedLimit)
      .map(({ at: _at, ...m }) => m),
  };
}

/** Effective font sizes this surface renders with, in px. */
export const FONT_SCALE_PX = {
  "--sub-font-xs": 12,
  "--sub-font-sm": 12.5,
  "--sub-font-base": 14.5,
  "--sub-font-lg": 17,
  "--sub-font-xl": 21,
} as const;

/** Component counts the density rule reads. */
export const COMPONENT_COUNTS = {
  cards: 3,
  chips: 7,
  feed_lines: 50,
  max_chips_per_row: 7,
} as const;

export interface UiViewReport {
  goal_dispatch: {
    open: boolean;
    effective_tokens: Record<string, string>;
    component_counts: Record<string, number>;
  };
  surface: string;
  /**
   * WHAT THIS SURFACE HAS ACTUALLY DRAWN, and by which branch of the planner.
   *
   * Added because the detector reading this report could see the surface's
   * TYPOGRAPHY and nothing about whether content was routed to a renderer that
   * suits it — and the live census found 35 of 126 impulses drawn as code
   * listings when they were single values. A legibility judgement that cannot
   * see form is blind to the larger half of legibility.
   *
   * MEASURED, and `observed: false` until a browser has rendered and reported.
   * See `form-census.ts` for why that distinction is load-bearing and why the
   * numbers cannot be derived here.
   */
  content_forms: FormCensus;
  /** The questions rail: what is asked of people here, how it is presented, and what they did with it. */
  asks: AsksView;
  /**
   * The view in force per region (src/ui-views.ts): which blocks it names, in order,
   * with their limits, and the revision. Revision 0 is the default. This is the view
   * the page draws; a block with nothing to show is left out when it is drawn.
   */
  views: Record<string, RegionView>;
  /** New panels and questions refused for carrying nothing, per shape, since `since` (src/write-refusals.ts). */
  refused_empty_writes: { uiPanel_write: number; uiQuestion_write: number; since: number };
}

export interface RegionView {
  id: string;
  revision: number;
  blocks: readonly string[];
  limits: Readonly<Record<string, number>>;
  written_by: string | null;
  /** The run the write named: dispatch, execution and template ids, as the writer claimed them. */
  run: { dispatch_id: string | null; execution_id: string | null; template_id: string | null } | null;
  written_at: number | null;
  undo_of: number | null;
}

function buildViews(): Record<string, RegionView> {
  const out: Record<string, RegionView> = {};
  for (const region of Object.keys(VIEW_REGIONS) as ViewRegion[]) {
    const v = currentView(region);
    out[region] = { id: v.id, revision: v.revision, blocks: v.blocks, limits: v.limits, written_by: v.writtenBy, run: v.run ? { dispatch_id: v.run.dispatchId, execution_id: v.run.executionId, template_id: v.run.templateId } : null, written_at: v.revision > 0 ? v.writtenAt : null, undo_of: v.undoOf };
  }
  return out;
}

/**
 * `overrides` are the live `renderPolicy.tokenOverrides`. They are folded in
 * here so the detector reads the values the surface is ACTUALLY rendering with
 * right now — not the values it shipped with. An effect-reading validator that
 * reads compile-time defaults is reading a stale surface.
 */
export function buildUiView(overrides: Record<string, string> = {}): UiViewReport {
  const effective_tokens: Record<string, string> = {};
  for (const [k, v] of Object.entries(FONT_SCALE_PX)) {
    effective_tokens[k] = `${v}px`;
  }
  // Map the surface's own --sf-* override names onto the --sub-font-* names the
  // detector reads, so a live fix is visible to it.
  const SF_TO_SUB: Record<string, string> = {
    "--sf-text-xs": "--sub-font-xs",
    "--sf-text-sm": "--sub-font-sm",
    "--sf-text-base": "--sub-font-base",
    "--sf-text-lg": "--sub-font-lg",
    "--sf-text-xl": "--sub-font-xl",
  };
  for (const [k, v] of Object.entries(overrides)) {
    const mapped = SF_TO_SUB[k] ?? (k.startsWith("--sub-font-") ? k : null);
    if (mapped) effective_tokens[mapped] = v;
  }
  return {
    goal_dispatch: {
      open: true,
      effective_tokens,
      // STILL DECLARED, and still the cautionary instance two other modules in
      // this vessel cite by name. Left alone in this change rather than quietly
      // half-fixed: making these measured needs the browser to report component
      // counts the way it now reports form decisions, and doing it as a
      // side-effect of the form work would ship an unreviewed second census.
      // The form census beside it is measured; the difference is deliberate and
      // this comment is the record of it.
      component_counts: { ...COMPONENT_COUNTS },
    },
    surface: "human-surface-vessel",
    content_forms: buildFormCensus(),
    asks: buildAsksView(),
    views: buildViews(),
    refused_empty_writes: emptyRefusals(),
  };
}
