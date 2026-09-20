/**
 * The exposure record: what this surface ACTUALLY PUT ON SCREEN, and what the
 * person then did with it.
 *
 * WHY IT EXISTS NOW. A ranking that never changes from evidence orders the wall
 * and learns nothing. The importance learner needs a record of the things it
 * ranked highly enough to be presented, and of what became of them — otherwise
 * every update it makes is conditioned on the ranking's own output rather than
 * on the world. This file is that record's producer. It was deliberately not
 * built twice before because it had no consumer; the learner is the consumer.
 *
 * THE HONESTY CONSTRAINT THAT GOVERNS EVERY NAME HERE. Attention is not
 * observable from a browser. The strongest true claim available is that an
 * element's box intersected the viewport box (clipped by its scroll ancestors)
 * at the moment of a presentation tick. Nothing here may be named `seen`,
 * `viewed`, `read`, or `noticed`: a learner handed a field called `seen` will
 * treat it as attended, and every weight it derives will be a claim about a
 * person's mind that no measurement supports. The field is
 * `visible_in_viewport`, and it means exactly its name.
 *
 * WHAT IS NOT A NEGATIVE OUTCOME. A solicitation that was never in a visible
 * slice produces NO record at all. "Never shown" is the absence of evidence,
 * not evidence of unimportance — scoring it as a negative is how a learner
 * learns what happened to be on top instead of what matters.
 * `candidates_total` and `not_in_visible_slice_count` exist so the record is
 * honest about how much was withheld, and they are DENOMINATORS: deliberately
 * not named `outcome` anything, and never fed as negatives.
 *
 * WHY THE BUNDLE IS READ FROM THE LOADED SCRIPT. `src/ui-view.ts` bakes
 * COMPONENT_COUNTS in as an `as const` literal, so the only grader of this
 * surface reads fiction that no rebuild can invalidate. A build-time constant
 * naming the renderer would repeat that defect. The bundle identity is read at
 * use time off the `<script>` element the browser actually executed; when it
 * cannot be read it is recorded as `null` and listed in `unobservable`, never
 * guessed.
 */

export type Visibility = "public" | "operator_only";

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * One candidate element, as measured. `clips` is the chain of boxes that crop
 * it — every scrollable ancestor's client box, plus the viewport. An element
 * scrolled out of an internally-scrolling list is cropped to nothing by that
 * list's box even when the list itself is on screen, which is precisely the
 * case a naive "is it in the DOM" check reports as shown.
 */
export interface Candidate {
  readonly solicitationId: string;
  readonly rank: number;
  readonly rankSource: "ranker" | "dom_order";
  readonly rankingExplanation: string | null;
  readonly elementRole: string;
  /** Position in rendered document order, 1-based. Recorded alongside `rank` so a
   * ranker-declared rank that does not match what the DOM actually put first is
   * visible in the record instead of being silently reconciled. */
  readonly domPosition: number;
  readonly rect: Rect;
  readonly clips: readonly Rect[];
}

export interface VisibleItem {
  readonly solicitation_id: string;
  readonly rank: number;
  readonly rank_source: "ranker" | "dom_order";
  /** Verbatim explanation the item was shown with; null when the renderer published none. */
  readonly ranking_explanation: string | null;
  readonly ranking_explanation_observed: boolean;
  readonly element_role: string;
  readonly dom_position: number;
  /** Fraction of the element's own box that survived cropping by the clip chain. */
  readonly visible_fraction: number;
}

function area(r: Rect): number {
  return Math.max(0, r.width) * Math.max(0, r.height);
}

function intersect(a: Rect, b: Rect): Rect {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return { x, y, width: right - x, height: bottom - y };
}

/**
 * Fraction of `rect` that remains after cropping by every box in `clips`.
 * A zero-area element (a `hidden` detail pane, `display:none`) yields 0 — it is
 * present in the DOM and not on screen, and that difference is the whole point
 * of this measurement.
 */
export function visibleFraction(rect: Rect, clips: readonly Rect[]): number {
  const own = area(rect);
  if (own <= 0) return 0;
  let current = rect;
  for (const clip of clips) {
    current = intersect(current, clip);
    if (area(current) <= 0) return 0;
  }
  return area(current) / own;
}

/** Default: at least half an element's box uncropped counts as in the slice. */
export const MIN_VISIBLE_FRACTION = 0.5;

export function visibleSlice(
  candidates: readonly Candidate[],
  minFraction: number = MIN_VISIBLE_FRACTION,
): VisibleItem[] {
  const items: VisibleItem[] = [];
  for (const candidate of candidates) {
    const fraction = visibleFraction(candidate.rect, candidate.clips);
    if (fraction < minFraction) continue;
    items.push({
      solicitation_id: candidate.solicitationId,
      rank: candidate.rank,
      rank_source: candidate.rankSource,
      ranking_explanation: candidate.rankingExplanation,
      ranking_explanation_observed: candidate.rankingExplanation !== null,
      element_role: candidate.elementRole,
      dom_position: candidate.domPosition,
      visible_fraction: Math.round(fraction * 1000) / 1000,
    });
  }
  return items.sort((a, b) => a.rank - b.rank || (a.solicitation_id < b.solicitation_id ? -1 : 1));
}

// ─── outcomes ───────────────────────────────────────────────────────────────

/**
 * The four states a shown solicitation can end in, kept distinct on purpose.
 *
 * `answered` and `declined` are different acts; `complained` is a statement
 * about the interface rather than about the question; `shown_not_acted` is the
 * only one the machine infers, and it is inferred ONLY from re-presentation
 * without an intervening act. Collapsing any pair of these into one number
 * destroys the signal the learner exists to use: "declined twice" and
 * "answered twice" would move a weight the same way.
 */
export type ExposureOutcome = "answered" | "declined" | "complained" | "shown_not_acted";

/**
 * Whether the act addressed the whole solicitation or one of its asks. The
 * store this record accompanies reads `declined` only when there is no
 * `ask_id`, so a per-ask decline is written there and never read; carrying
 * `scope` and `ask_id` here keeps the two distinguishable in the record even
 * while that is true of the store.
 */
export type OutcomeScope = "panel" | "ask";

export interface OutcomeEvent {
  readonly solicitationId: string;
  readonly outcome: ExposureOutcome;
  readonly scope: OutcomeScope;
  readonly askId: string | null;
  /** How many presentation ticks had this id in the visible slice when the act happened. */
  readonly exposureCount: number;
}

/**
 * Per-session bookkeeping over presentation ticks and human acts.
 *
 * Tick rule, deliberately not a timer: a tick happens when a snapshot of
 * solicitations is accepted for display (first paint, and each accepted
 * refresh). A timer-driven tick would manufacture exposure counts for a page
 * nobody is in front of — which is exactly the inference this record must not
 * make.
 */
export class ExposureLedger {
  private readonly exposures = new Map<string, number>();
  private readonly acted = new Set<string>();

  /**
   * Record that these ids were in the visible slice of one tick. Returns the
   * inferred `shown_not_acted` events: an id visible on a tick AFTER its first,
   * with no human act recorded against it yet. The first exposure never
   * produces one — being shown once and not yet answered is not evidence of
   * anything.
   */
  tick(visibleIds: readonly string[]): OutcomeEvent[] {
    const events: OutcomeEvent[] = [];
    for (const id of new Set(visibleIds)) {
      const count = (this.exposures.get(id) ?? 0) + 1;
      this.exposures.set(id, count);
      if (count > 1 && !this.acted.has(id)) {
        events.push({
          solicitationId: id,
          outcome: "shown_not_acted",
          scope: "panel",
          askId: null,
          exposureCount: count,
        });
      }
    }
    return events;
  }

  /** Exposure ticks in which this id was in the visible slice. 0 = never shown. */
  exposureCount(id: string): number {
    return this.exposures.get(id) ?? 0;
  }

  /**
   * Record a human act. Any act — panel-level or ask-level — stops the
   * `shown_not_acted` inference for that id, because the person demonstrably
   * acted; the act's own scope stays in the record rather than being folded in.
   */
  act(solicitationId: string, outcome: Exclude<ExposureOutcome, "shown_not_acted">, askId?: string | null): OutcomeEvent {
    this.acted.add(solicitationId);
    const ask = askId && askId.length > 0 ? askId : null;
    return {
      solicitationId,
      outcome,
      scope: ask ? "ask" : "panel",
      askId: ask,
      exposureCount: this.exposureCount(solicitationId),
    };
  }
}

// ─── records ────────────────────────────────────────────────────────────────

export interface PresentationConditions {
  /** Filename/hash of the module script the browser actually executed; null when unreadable. */
  readonly rendererBundle: string | null;
  readonly viewport: { readonly width: number; readonly height: number } | null;
  /** Variant adopted from the renderPolicy impulse at page load; null when not yet adopted. */
  readonly presentationVariant: string | null;
}

export interface ExposureRecordInput extends PresentationConditions {
  /** Solicitations present in the accepted snapshot — the denominator. */
  readonly snapshotCount: number;
  /** Elements carrying a solicitation id that were found to measure. */
  readonly candidates: readonly Candidate[];
  readonly visible: readonly VisibleItem[];
  readonly tickSeq: number;
  readonly measuredSelector: string;
}

/** The machine-origin marker. First field of every record this module emits. */
export const MACHINE_ORIGIN = "machine" as const;
export const PRODUCER = "human-surface-vessel/ui/exposure-reporter" as const;

/**
 * Build the `interactorObservation` pointer for one presentation tick.
 *
 * `origin` and `producer` are the first two keys, so the marker survives
 * JSON.stringify and is on line one of any pretty-printed journal row: nothing
 * downstream may mistake a machine measurement for a human contribution. (The
 * inverse pollution already happened once on `uiFeedback_write` — 48 goal-walk
 * payloads in the operator-verdict corpus — and is now refused at
 * development-vessel/src/resolvers/interactor-passthrough.ts:72.)
 *
 * An unobservable target is a FAILED scan, not a clean one: a snapshot holding
 * solicitations while no element carries an id means the reporter is measuring
 * the wrong tree, and reporting an empty slice for that would look identical to
 * "nothing was shown". Precedent:
 * development-vessel/src/resolvers/ui-legibility-scan.ts:95-115.
 */
export function buildExposureRecord(input: ExposureRecordInput): Record<string, unknown> {
  const unobservable: string[] = [];
  if (input.rendererBundle === null) unobservable.push("renderer_bundle");
  if (input.viewport === null) unobservable.push("viewport");
  if (input.presentationVariant === null) unobservable.push("presentation_variant");
  const failed = input.snapshotCount > 0 && input.candidates.length === 0;
  return {
    origin: MACHINE_ORIGIN,
    producer: PRODUCER,
    type: "interactorObservation",
    obs_type: "exposure",
    visibility: "operator_only" as Visibility,
    tick_seq: input.tickSeq,
    scan_status: failed ? "failed" : "observed",
    ...(failed
      ? {
          structured_error: {
            resolver: "ui_exposure_reporter",
            detail:
              `${input.snapshotCount} solicitation(s) were in the accepted snapshot but no element matched ` +
              `${input.measuredSelector}, so what was on screen could not be measured. This is a failed scan, ` +
              `not an empty one: treating it as "nothing was shown" would teach the learner that every ` +
              `solicitation in this snapshot went unpresented.`,
            measured_selector: input.measuredSelector,
          },
        }
      : {}),
    visible_in_viewport: input.visible,
    visible_in_viewport_count: input.visible.length,
    // Denominators. Not outcomes: an id absent from the slice gets no record.
    snapshot_count: input.snapshotCount,
    candidates_total: input.candidates.length,
    not_in_visible_slice_count: Math.max(0, input.candidates.length - input.visible.length),
    renderer_bundle: input.rendererBundle,
    viewport: input.viewport,
    presentation_variant: input.presentationVariant,
    measured_selector: input.measuredSelector,
    /** "visible in the viewport box", never "seen" — attention is not observable here. */
    claim: "element box intersected the viewport box, clipped by scroll ancestors, at this tick",
    unobservable,
  };
}

export function buildOutcomeRecord(
  event: OutcomeEvent,
  conditions: PresentationConditions,
): Record<string, unknown> {
  return {
    origin: MACHINE_ORIGIN,
    producer: PRODUCER,
    type: "interactorObservation",
    obs_type: "exposure_outcome",
    visibility: "operator_only" as Visibility,
    panel_id: event.solicitationId,
    ask_id: event.askId,
    outcome: event.outcome,
    outcome_scope: event.scope,
    exposure_count: event.exposureCount,
    /** Machine-inferred outcomes are marked; the other three are observed acts. */
    inferred: event.outcome === "shown_not_acted",
    renderer_bundle: conditions.rendererBundle,
    viewport: conditions.viewport,
    presentation_variant: conditions.presentationVariant,
  };
}

// ─── DOM measurement ────────────────────────────────────────────────────────

export const SOLICITATION_ATTR = "data-solicitation-id";
export const MEASURED_SELECTOR = `[${SOLICITATION_ATTR}]`;

/**
 * Rank and explanation are read from the DOM rather than imported, so this
 * reporter does not depend on which module ranks. The ranking renderer
 * publishes `data-rank` and `data-rank-explanation` on the same element that
 * carries `data-solicitation-id`; until it does, rank is the rendered order and
 * `rank_source` says so. A fabricated explanation is never substituted.
 */
export function collectCandidates(root: ParentNode, viewport: Rect): Candidate[] {
  const elements = Array.from(root.querySelectorAll<HTMLElement>(MEASURED_SELECTOR));
  const candidates: Candidate[] = [];
  elements.forEach((element, index) => {
    const id = element.getAttribute(SOLICITATION_ATTR);
    if (!id) return;
    const declared = element.getAttribute("data-rank");
    const rank = declared !== null && Number.isFinite(Number(declared)) ? Number(declared) : index + 1;
    candidates.push({
      solicitationId: id,
      rank,
      rankSource: declared !== null ? "ranker" : "dom_order",
      rankingExplanation: element.getAttribute("data-rank-explanation"),
      elementRole: element.getAttribute("data-exposure-role") ?? "unlabelled",
      domPosition: index + 1,
      rect: toRect(element.getBoundingClientRect()),
      clips: [...clipChain(element), viewport],
    });
  });
  return candidates;
}

function toRect(box: { x: number; y: number; width: number; height: number }): Rect {
  return { x: box.x, y: box.y, width: box.width, height: box.height };
}

/** Client boxes of every ancestor that crops overflow. */
function clipChain(element: HTMLElement): Rect[] {
  const clips: Rect[] = [];
  let parent = element.parentElement;
  while (parent) {
    const style = getComputedStyle(parent);
    if (/(auto|scroll|hidden|clip)/.test(style.overflowX + " " + style.overflowY)) {
      const box = parent.getBoundingClientRect();
      clips.push({
        x: box.x + parent.clientLeft,
        y: box.y + parent.clientTop,
        width: parent.clientWidth,
        height: parent.clientHeight,
      });
    }
    parent = parent.parentElement;
  }
  return clips;
}

/** Read at use time off the executed script element. Never a build constant. */
export function readRendererBundle(doc: Document): string | null {
  const scripts = Array.from(doc.querySelectorAll<HTMLScriptElement>("script[src]"));
  const module = scripts.find((s) => s.type === "module") ?? scripts[0];
  if (!module?.src) return null;
  try {
    return new URL(module.src, doc.baseURI).pathname.split("/").pop() ?? null;
  } catch {
    return null;
  }
}

export function readConditions(win: Window): PresentationConditions {
  const variant = win.document.documentElement.dataset["presentation"];
  return {
    rendererBundle: readRendererBundle(win.document),
    viewport:
      win.innerWidth > 0 && win.innerHeight > 0
        ? { width: win.innerWidth, height: win.innerHeight }
        : null,
    presentationVariant: variant && variant.length > 0 ? variant : null,
  };
}
