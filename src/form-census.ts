/**
 * THE FORM CENSUS: what this surface has ACTUALLY DRAWN, counted from records.
 *
 * ── WHY THIS IS MEASURED AND NOT DECLARED ─────────────────────────────────
 *
 * `ui-view.ts` publishes the surface's self-report to `ui_legibility_scan`, the
 * substrate's own detector, and its `COMPONENT_COUNTS` are an `as const`
 * literal. So the only automated grader of this interface reads three numbers
 * that no rebuild can invalidate and that were last true whenever somebody typed
 * them. Two other modules in this vessel already cite that as the cautionary
 * instance (`importance.ts` and `store.ts` both name it by line). Adding a
 * declared form census beside it would be the same defect with a second face.
 *
 * So every number here comes from `form_decision` observations — the records the
 * browser writes after committing a render, naming the shape, a signature of
 * the content, the chosen form, and WHICH BRANCH chose it.
 *
 * ── WHY THE BROWSER IS THE RIGHT MEASURING POINT ──────────────────────────
 *
 * The planner runs in the browser, and re-deriving the forms server-side would
 * be a second implementation grading the first — it would report what the
 * server BELIEVES would be drawn, which is exactly the class of claim this file
 * exists to stop making. It is also not available: the planner's form
 * vocabulary comes from `@avigopal/design-tokens`, which resolves through a
 * vite alias into the super-repo and is absent from the container the vessel
 * runs in (law 11 — the vessel must not reach out of its own tree at runtime).
 * A server-side import would typecheck on this workstation and crash the unit
 * on boot in the image.
 *
 * ── NOT OBSERVED IS NOT ZERO ──────────────────────────────────────────────
 *
 * The distinction this file most has to preserve. Until a browser renders and
 * reports, there is no census — and `observed: false` is what it says, not a
 * table of zeros. A detector handed zeros would read them as "nothing was drawn
 * badly" and grade the surface clean from a population of runs in which nobody
 * ever looked. `ui_legibility_scan`'s own header spells out where that ends: a
 * detector graded on "I could not look" converges on reliable and becomes a
 * self-confirming oracle for itself.
 */

import { recentObservations, type Observation } from "./store.ts";

/** How many observations back the census reads. The store's own cap is 500. */
const CENSUS_WINDOW = 500;

export interface FormCensus {
  /**
   * False until at least one `form_decision` record exists. When false every
   * count below is absent rather than zero — see the header.
   */
  readonly observed: boolean;
  readonly decisions_total?: number;
  /** Distinct (shape, content signature) pairs behind those decisions. */
  readonly distinct_payloads?: number;
  readonly distinct_shapes?: number;
  readonly by_form?: Record<string, number>;
  readonly by_decided_by?: Record<string, number>;
  readonly by_region?: Record<string, number>;
  /**
   * Payloads that landed on the verbatim default AND are short single-line
   * values — the misroute class that motivated the scalar rescue, kept as a
   * standing count so its return is visible rather than re-discovered by hand.
   * A non-zero value here is a finding, not a statistic.
   */
  readonly bare_values_as_verbatim?: number;
  /** Epoch ms of the most recent decision the census read. */
  readonly last_observed_at?: number;
  /** Named so a reader knows the census is a window, not the whole history. */
  readonly window: number;
}

interface DecisionRow {
  shape?: unknown;
  content_signature?: unknown;
  form?: unknown;
  decided_by?: unknown;
  drawn_chars?: unknown;
  single_line?: unknown;
  truncated?: unknown;
  region?: unknown;
}

function rowsOf(observation: Observation): DecisionRow[] {
  const body = observation.body as { decisions?: unknown } | undefined;
  const decisions = body?.decisions;
  if (!Array.isArray(decisions)) return [];
  return decisions.filter((d): d is DecisionRow => Boolean(d) && typeof d === "object");
}

/**
 * The composite-key separator, written as an ESCAPE and not as a raw byte.
 *
 * NUL is the right separator — it cannot occur in a shape name, a signature, a
 * form, or a region, so no pair of distinct keys can collide by concatenation.
 * But a RAW NUL in a source file makes that file binary to git and invisible to
 * grep, which this repository has already paid for once: eight vessel sources
 * were silently unsearchable because a raw NUL was used exactly this way. The
 * escape gives the same byte at runtime and keeps the file text.
 */
const KEY_SEP = "\u0000";

function bump(into: Record<string, number>, key: unknown): void {
  if (typeof key !== "string" || key.length === 0) return;
  into[key] = (into[key] ?? 0) + 1;
}

/**
 * Count the census out of the observation window.
 *
 * Deliberately dependency-free and synchronous: it is called from the
 * `obsidian:ui_view` handler, which the detector polls, and a census that did
 * I/O would make the self-report's availability depend on something other than
 * the surface being up.
 */
export function buildFormCensus(
  /**
   * The observation reader, injectable ONLY so the cold case is testable.
   *
   * `observed: false` on an empty corpus is the property this module exists to
   * hold, and it cannot be asserted in a process that has already recorded a
   * decision — the store is module state with no reset. A test that skipped it
   * for that reason would leave the one branch that prevents a self-confirming
   * detector as the one branch nothing covers.
   */
  read: (limit: number) => readonly Observation[] = recentObservations,
): FormCensus {
  const decisions = read(CENSUS_WINDOW).filter((o) => o.type === "form_decision");
  if (decisions.length === 0) return { observed: false, window: CENSUS_WINDOW };

  const byForm: Record<string, number> = {};
  const byDecidedBy: Record<string, number> = {};
  const byRegion: Record<string, number> = {};
  const payloads = new Set<string>();
  const shapes = new Set<string>();
  let total = 0;
  let bareVerbatim = 0;
  let lastAt = 0;

  for (const observation of decisions) {
    lastAt = Math.max(lastAt, observation.observedAt);
    for (const row of rowsOf(observation)) {
      total += 1;
      bump(byForm, row.form);
      bump(byDecidedBy, row.decided_by);
      bump(byRegion, row.region);
      if (typeof row.shape === "string") shapes.add(row.shape);
      if (typeof row.shape === "string" && typeof row.content_signature === "string") {
        payloads.add(`${row.shape}${KEY_SEP}${row.content_signature}`);
      }
      /*
       * The misroute class, counted from the record rather than re-judged here.
       *
       * ALL FOUR CONDITIONS ARE REQUIRED, and the two added last are what keep
       * this bucket from being a false-positive generator once a gap-filing
       * detector reads it:
       *
       *   • `single_line` — a short MULTI-line payload (a two-line `git_status`)
       *     is correctly verbatim and is not a value drawn as a listing. The
       *     census cannot infer this, which is why the browser records it.
       *   • `!truncated` — the rescue refuses truncated content BY DESIGN, so
       *     counting a truncated short preview here would report the planner's
       *     correct behaviour as a defect.
       *
       * A row from a build that predates `single_line` is not counted: an
       * absent field is unknown, and guessing it would put the bucket's
       * meaning back where these two conditions took it from.
       */
      if (
        row.form === "text" &&
        typeof row.drawn_chars === "number" &&
        row.drawn_chars <= 300 &&
        row.single_line === true &&
        row.truncated !== true
      ) {
        bareVerbatim += 1;
      }
    }
  }

  // Records existed but carried no usable rows. That is not a clean census —
  // the route refuses an empty `decisions[]`, so this means malformed entries
  // got through, and reporting `observed: true` with zero counts would claim a
  // measurement nobody made.
  if (total === 0) return { observed: false, window: CENSUS_WINDOW };

  return {
    observed: true,
    decisions_total: total,
    distinct_payloads: payloads.size,
    distinct_shapes: shapes.size,
    by_form: byForm,
    by_decided_by: byDecidedBy,
    by_region: byRegion,
    bare_values_as_verbatim: bareVerbatim,
    last_observed_at: lastAt,
    window: CENSUS_WINDOW,
  };
}
