/**
 * Importance scoring for the human surface.
 *
 * The directive: "the system should always show what it thinks is most
 * important, and it should learn what is important from what it shows." This
 * module is the FIRST half — a pure, replayable ordering function — and it is
 * deliberately shaped so the second half can drive it: every number that
 * influences an order arrives as `ImportanceWeights` DATA, so a learner can
 * replace the whole set without touching a line of this file. There is no
 * importance constant in this module's logic. (The vessel already carries the
 * cautionary instance of the opposite: `ui-view.ts`'s COMPONENT_COUNTS is an
 * `as const` literal, so the only grader of the surface reads fiction.)
 *
 * PURITY IS A REQUIREMENT, NOT A STYLE. No I/O, no store access, no clock:
 * `nowMs` is a parameter. A scorer that reads the clock cannot be tested and
 * cannot be replayed against a past trace to ask "why was THAT on top then".
 *
 * WHAT THIS MODULE DOES NOT SEE, stated so nobody mistakes silence for a
 * verdict: it takes no impression/shown count and no "never shown" flag. A
 * panel that was never displayed therefore CANNOT be scored down for not being
 * acted on — the one confusion that would turn "learn what is important" into
 * "learn what happened to be on top". Weighting shown-but-ignored is a real
 * signal, but it needs a weights field this interface does not have and a
 * populated impression count at write time; until both exist, scoring it would
 * be a key that is not actually populated.
 *
 * AGE IS MEASURED FROM `createdAt`, NOT `updatedAt`. On the live corpus the two
 * diverge hard: a single `gap_needs_human` escalation reads createdAt
 * 1787919287104 / updatedAt 1789893838040 — an automatic re-escalation touched
 * it. Keying the wait clock on `updatedAt` would let the substrate's own retry
 * loop reset the age of exactly the items that have been ignored longest (97 of
 * 250 live solicitations are 22 days old), which is the failure this ordering
 * exists to prevent.
 */

// `import type` (the statement form) is erased, so this file has NO runtime
// dependency on store.ts. That is load-bearing, not tidiness: store.ts now reads
// DEFAULT_IMPORTANCE_WEIGHTS below while building its initial render policy, and
// a runtime edge back to store.ts would close a cycle that throws
// `ReferenceError: Cannot access 'DEFAULT_IMPORTANCE_WEIGHTS' before
// initialization` whenever this module is loaded first (measured on bun 1.3.9).
// The predicate therefore comes from the leaf module store.ts re-exports.
import type { Panel } from "./store.ts";
import { isSolicitation } from "./solicitation.ts";

const MS_PER_DAY = 86_400_000;

/**
 * Weights are the entire policy. `byKind` and `declaredImportance` are OPEN
 * maps: a key the map lacks is scored at that map's neutral value (see
 * `neutralOf`), never dropped and never zeroed-to-the-bottom.
 */
export interface ImportanceWeights {
  readonly byKind: Record<string, number>;
  readonly agePerDay: number;
  readonly declaredImportance: Record<string, number>;
  readonly unansweredBoost: number;
}

/**
 * A starting point, not a law. A caller — including a learner — may replace this
 * wholesale, and the scorer must behave for weights it has never seen.
 *
 * Calibration recorded so a future weight-learner knows which invariant it is
 * trading away when it changes a number:
 *   unansweredBoost (24) > agePerDay x 22 (8.8)
 *                        + spread(byKind) (10 - 0.5 = 9.5)
 *                        + spread(declaredImportance) (3 - 0 = 3)  = 21.3
 * i.e. over the OBSERVED live age range (0..22 days) nothing an item can
 * accumulate from kind, declared importance and waiting will lift a resolved
 * item above an unresolved one. Ordering work happens WITHIN the unresolved
 * set. That relationship is a property of these defaults; the scorer itself
 * does not enforce it and will faithfully invert if the weights say so.
 *
 * `declaredImportance` is kept small on purpose: the live corpus is 240 "high"
 * to 10 "medium", so the field the substrate writes today can barely
 * discriminate. Kind, age and unresolvedness carry the signal.
 */
export const DEFAULT_IMPORTANCE_WEIGHTS: ImportanceWeights = {
  byKind: {
    gap_needs_human: 10,
    gap_reland_needs_human: 10,
    question: 8,
    code_change: 7,
    gap_needs_localization: 6,
    gap_pending_verification: 4,
    info: 1,
    pulse: 0.5,
  },
  agePerDay: 0.4,
  declaredImportance: { high: 3, medium: 1, low: 0 },
  unansweredBoost: 24,
};

/**
 * What the scorer needs from a panel. Structurally a subset of `Panel` plus the
 * two resolution flags `questionView()` already computes, so a `Panel`, a
 * `questionView(panel)` result, and a raw `uiQuestion` row are all assignable
 * without a new shape being minted for this module.
 *
 * `answered`/`declined` absent means "no resolution recorded", which is treated
 * as unresolved — and worded that way, because an absent view state is not
 * evidence about what a human did.
 */
export type ScorablePanel = Pick<Panel, "kind" | "importance" | "createdAt"> & {
  readonly id: string;
  readonly title?: string;
  readonly updatedAt?: number;
  readonly answered?: boolean;
  readonly declined?: boolean;
};

export interface ScoredPanel {
  readonly panel: ScorablePanel;
  readonly score: number;
  readonly because: readonly string[];
}

/** Non-finite (NaN/Infinity) weights are treated as 0 so one bad table entry cannot poison an order into garbage. */
function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * The documented neutral for an open map: the arithmetic mean of the weights it
 * DOES carry (0 for an empty map). An unrecognised key therefore scores like an
 * average recognised one — it is neither promoted nor buried, and it moves with
 * the weights instead of anchoring to a constant hidden in this file.
 */
function neutralOf(table: Record<string, number>): number {
  const values = Object.values(table ?? {}).map(num);
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function lookup(table: Record<string, number>, key: string): { weight: number; known: boolean } {
  const known = Boolean(table) && Object.prototype.hasOwnProperty.call(table, key);
  return { weight: known ? num(table[key]) : neutralOf(table), known };
}

/** Human phrasing for the kinds we know about. Display only — never a gate, never consulted for a score. */
const KIND_PHRASES: Record<string, string> = {
  gap_needs_human: "a gap escalated to you after repeated failed repairs",
  gap_reland_needs_human: "a repair landed once, came back, and now needs you",
  gap_needs_localization: "a gap the system cannot aim at a file yet",
  gap_pending_verification: "a repair is waiting for someone to confirm it worked",
  question: "the system is asking you a direct question",
  code_change: "a proposed code change is waiting on you",
  info: "something the system is telling you",
  pulse: "a routine status note",
};

/**
 * Score one panel. Pure: identical `(panel, weights, nowMs)` always yields an
 * identical score and an identical `because`.
 */
export function scorePanel(
  panel: ScorablePanel,
  weights: ImportanceWeights,
  nowMs: number,
): ScoredPanel {
  const because: string[] = [];

  const kind = lookup(weights.byKind, panel.kind);
  because.push(
    kind.known
      ? (KIND_PHRASES[panel.kind] ?? `it is a "${panel.kind}"`)
      : `it is a kind nobody has ranked yet ("${panel.kind}"), so it is scored at the neutral default rather than hidden`,
  );

  const importance = lookup(weights.declaredImportance, panel.importance);
  because.push(
    importance.known
      ? `the substrate declared importance "${panel.importance}"`
      : `the substrate declared importance "${panel.importance}", which has no weight yet, so it is scored at the neutral default`,
  );

  // Clock skew or a future-dated panel must not produce negative age.
  const ageDays = Math.max(0, (num(nowMs) - num(panel.createdAt)) / MS_PER_DAY);
  const ageContribution = num(weights.agePerDay) * ageDays;
  const wholeDays = Math.floor(ageDays);
  if (wholeDays >= 1) {
    because.push(`waiting ${wholeDays} day${wholeDays === 1 ? "" : "s"} since it was first raised`);
  } else {
    because.push("raised today");
  }

  // Three distinct states, kept distinct: answered, dismissed, and unresolved.
  // "Informational" is a fourth — nothing was ever asked, so unresolvedness is
  // not a fact about it. The predicate is store.ts's single one (law: one
  // predicate; its three re-derived copies diverged).
  let boost = 0;
  if (!isSolicitation(panel)) {
    because.push("nothing is being asked of you here, so it cannot be waiting on an answer");
  } else if (panel.answered === true) {
    because.push("you already answered it");
  } else if (panel.declined === true) {
    because.push("you dismissed it");
  } else {
    boost = num(weights.unansweredBoost);
    because.push("no answer recorded yet");
  }

  const score = kind.weight + importance.weight + ageContribution + boost;
  return { panel, score, because };
}

/**
 * Rank panels, highest score first.
 *
 * TIEBREAK: score descending, then `panel.id` ascending. The id is the only
 * field that cannot change while a human is reading the list — a tiebreak on
 * `updatedAt` (or on arrival order) makes the list reorder under the reader
 * every time the substrate touches a row, which is its own usability defect.
 * The input array is never mutated.
 */
export function rankPanels(
  panels: readonly ScorablePanel[],
  weights: ImportanceWeights,
  nowMs: number,
): readonly ScoredPanel[] {
  return panels
    .map(panel => scorePanel(panel, weights, nowMs))
    .sort((a, b) => (b.score - a.score) || a.panel.id.localeCompare(b.panel.id));
}

/**
 * A one-line summary a surface can print above the list. It states the top
 * item's leading reason — so a human has something concrete to DISAGREE with,
 * which is the signal the learning half needs — and, when a slice size is
 * given, how many ranked items are NOT visible. Claiming nothing about hiding
 * when no slice size is known is deliberate: an unknown hidden count must not
 * be reported as zero.
 */
export function explainRanking(scored: readonly ScoredPanel[], sliceSize?: number): string {
  const total = scored.length;
  if (total === 0) return "Nothing to show: no panels are ranked right now.";

  const top = scored[0];
  if (!top) return "Nothing to show: no panels are ranked right now.";
  const reason = top.because[0] ?? "no reason recorded";
  const lead = `top: "${top.panel.title ?? top.panel.id}" — ${reason}`;

  if (sliceSize === undefined || !Number.isFinite(sliceSize)) {
    return `Ranked ${total} item${total === 1 ? "" : "s"} by importance; ${lead}.`;
  }

  const visible = Math.max(0, Math.min(total, Math.floor(sliceSize)));
  const hidden = total - visible;
  const tail = hidden > 0 ? `${hidden} further ranked item${hidden === 1 ? "" : "s"} not shown` : "nothing further is hidden";
  return `Showing ${visible} of ${total} by importance; ${lead}; ${tail}.`;
}
