/**
 * The form LEARNER — the presentation counterpart of `importance-learn.ts`.
 *
 * `importance-learn.ts` learns WHICH solicitations to show first and states,
 * in its own header, that a complaint "is a statement about the PRESENTATION"
 * which it deliberately does not consume. This module consumes exactly that:
 * the exposure outcomes that carry the form that was on screen, and writes a
 * learned form table the planner consults BENEATH a human pin.
 *
 * ─── THE TWO HARD RULES, carried over verbatim ──────────────────────────────
 *
 * NEVER SHOWN MOVES NOTHING. Absence of evidence is not negative evidence. A
 * (shape, form) pair with no outcome records is not scored, and a shape with
 * no scored pair keeps its learned entry byte-identical. A learner that treats
 * silence as a verdict confirms whatever it already put on screen.
 *
 * A BOUNDED STEP. One record cannot swing a decision: nothing moves below an
 * observation floor, and the only move in v1 is the smallest one — fall back
 * to the surface's verbatim default — never a jump to an untried form.
 *
 * ─── WHAT IS SCORED ─────────────────────────────────────────────────────────
 *
 * The grade mapping is the INVERSION of importance-learn's carve-out:
 *   answered        → one success for (shape, form) — the presentation carried
 *                     the person to an act;
 *   complained      → one failure for (shape, form) — a statement about the
 *                     presentation, which is what this table is;
 *   declined        → nothing: a verdict on the QUESTION, not on its form;
 *   shown_not_acted → nothing: machine-inferred, not observed.
 *
 * Only records whose `form_source` is "dom" count: the form was read off the
 * measured row at act time (`ui/src/lib/exposure.ts`), never guessed. A
 * record without a form is skipped and SAID to be skipped.
 *
 * ─── V1 IS DEMOTE-ONLY, AND SAYS SO ─────────────────────────────────────────
 *
 * The deterministic planner picks the same form for the same content every
 * time, so no alternative form ever accumulates evidence: there is no variance
 * source. The learner can therefore learn that a form is being complained
 * about, and fall the shape back to the surface's verbatim default ("text"),
 * but it cannot learn that another form is BETTER — promoting an unexplored
 * form at Beta(1,1) is exactly the "never shown moves nothing" violation. A
 * pair that recovers above the threshold lifts its entry. Human pins remain
 * the variance source until an explore arm exists.
 *
 * ─── WHAT THIS MODULE DOES NOT DO ────────────────────────────────────────────
 *
 * It does not write. It returns the table it wants written, so the caller in
 * `routes/impulses.ts` — the same trigger the importance pass runs at — can
 * merge it into ONE `renderPolicy` write and the revision bumps once. No HTTP,
 * no store mutation, no timers.
 */
import {
  PRIOR_ALPHA,
  PRIOR_BETA,
  exclusionClause,
  readExposureCorpusWithExclusions,
} from "./importance-learn.ts";
import { getRenderPolicy } from "./store.ts";
import { readParticipation } from "./participation-journal.ts";

export const FORM_LEARNER_ID = "activity:form_learn@human-surface-vessel";

/** Below this many scored outcomes a pair is noise, not evidence. */
export const FORM_OBSERVATION_FLOOR = 5;
/** Posterior mean α/(α+β) at or below which a form is demoted for its shape. */
export const FORM_DEMOTE_THRESHOLD = 1 / 3;
/**
 * Posterior mean at or above which a form PEOPLE CHOSE is promoted for its
 * shape. Promotion needs FORM_OBSERVATION_FLOOR explicit choices of that form:
 * a person picking it is the variance source v1 lacked, so this is not
 * "promoting an unexplored form" — people explored it.
 */
export const FORM_PROMOTE_THRESHOLD = 2 / 3;
/** The surface's verbatim default; the only form v1 ever writes. */
export const FALLBACK_FORM = "text";
/** Rows in the participation list are planned under this shape (`QUESTION_CONTENT_SHAPE`). */
export const DEFAULT_ROW_SHAPE = "human_question";

export interface PairEvidence {
  readonly shape: string;
  readonly form: string;
  readonly alpha: number;
  readonly beta: number;
  readonly successes: number;
  readonly failures: number;
  readonly mean: number;
  /** How many of the successes were a person explicitly choosing this form (form_choice). */
  readonly chosen: number;
}

export interface FormMove {
  readonly shape: string;
  readonly from: string | null;
  readonly to: string | null;
  readonly because: PairEvidence;
}

export interface FormLearningPass {
  readonly changed: boolean;
  /** The table the caller should write when `changed`; the current table otherwise. */
  readonly learnedFormByShape: Record<string, string>;
  readonly moves: readonly FormMove[];
  readonly evidence: readonly PairEvidence[];
  readonly skipped: readonly { readonly reason: string; readonly count: number }[];
  readonly reason: string;
  readonly learnerId: typeof FORM_LEARNER_ID;
}

type Rec = Record<string, unknown>;

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function round4(v: number): number {
  return Math.round(v * 10_000) / 10_000;
}

/**
 * Score the corpus into (shape, form) pairs. Pure: same corpus, same pairs.
 * Exported so the falsifier can feed it a hand-built corpus.
 */
export function aggregateFormEvidence(
  records: readonly Rec[],
): { pairs: PairEvidence[]; skipped: { reason: string; count: number }[] } {
  const tally = new Map<string, { shape: string; form: string; s: number; f: number; c: number }>();
  const skipped = new Map<string, number>();
  const skip = (reason: string) => skipped.set(reason, (skipped.get(reason) ?? 0) + 1);

  for (const rec of records) {
    // A person moved one payload from one form to another: against the form
    // left (a statement about presentation, weighed like a complaint), and for
    // the form chosen.
    if (rec["type"] === "form_choice") {
      const body = (rec["body"] ?? {}) as Rec;
      const shape = str(body["shape"]);
      const from = str(body["form_from"]);
      const to = str(body["form_to"]);
      if (!shape || !from || !to || from === to) { skip("form_choice_incomplete"); continue; }
      const away = tally.get(`${shape}\u0000${from}`) ?? { shape, form: from, s: 0, f: 0, c: 0 };
      away.f += 1;
      tally.set(`${shape}\u0000${from}`, away);
      const toward = tally.get(`${shape}\u0000${to}`) ?? { shape, form: to, s: 0, f: 0, c: 0 };
      toward.s += 1;
      toward.c += 1;
      tally.set(`${shape}\u0000${to}`, toward);
      continue;
    }
    if (rec["type"] !== "exposure_outcome") continue;
    const outcome = str(rec["outcome"]);
    // The join fields ride in the observation body (everything outside the
    // column keys lands there — see `observationBody` in routes/impulses.ts).
    const body = (rec["body"] ?? {}) as Rec;
    const form = str(body["form"]) ?? str(rec["form"]);
    const source = str(body["form_source"]) ?? str(rec["form_source"]);
    if (!form || source !== "dom") {
      skip("no_form_on_record");
      continue;
    }
    if (outcome === "declined") { skip("declined_is_about_the_question"); continue; }
    if (outcome === "shown_not_acted") { skip("inferred_not_observed"); continue; }
    if (outcome !== "answered" && outcome !== "complained") { skip("unknown_outcome"); continue; }
    const shape = str(body["shape"]) ?? str(rec["panelKind"]) ?? DEFAULT_ROW_SHAPE;
    const key = `${shape}\u0000${form}`;
    const cell = tally.get(key) ?? { shape, form, s: 0, f: 0, c: 0 };
    if (outcome === "answered") cell.s += 1; else cell.f += 1;
    tally.set(key, cell);
  }

  const pairs: PairEvidence[] = [];
  for (const cell of tally.values()) {
    const alpha = PRIOR_ALPHA + cell.s;
    const beta = PRIOR_BETA + cell.f;
    pairs.push({
      shape: cell.shape,
      form: cell.form,
      alpha,
      beta,
      successes: cell.s,
      failures: cell.f,
      mean: round4(alpha / (alpha + beta)),
      chosen: cell.c,
    });
  }
  pairs.sort((a, b) => (a.shape + a.form).localeCompare(b.shape + b.form));
  return { pairs, skipped: [...skipped].map(([reason, count]) => ({ reason, count })) };
}

/**
 * Decide the learned table from scored pairs and the current table. Pure.
 *
 * Demote: a pair at or past the floor whose mean is at or below the threshold
 * sets `learned[shape] = "text"` — unless the complained-about form IS the
 * fallback, in which case there is nowhere lower to go and nothing moves.
 * Lift: a shape whose learned entry exists but whose every scored pair is
 * above the threshold loses its entry. Shapes with no scored pair are not
 * touched (never shown moves nothing).
 */
export function decideLearnedForms(
  pairs: readonly PairEvidence[],
  current: Readonly<Record<string, string>>,
): { next: Record<string, string>; moves: FormMove[] } {
  const next: Record<string, string> = { ...current };
  const moves: FormMove[] = [];
  const byShape = new Map<string, PairEvidence[]>();
  for (const p of pairs) byShape.set(p.shape, [...(byShape.get(p.shape) ?? []), p]);

  for (const [shape, shapePairs] of byShape) {
    const scored = shapePairs.filter((p) => p.successes + p.failures >= FORM_OBSERVATION_FLOOR);
    if (scored.length === 0) continue; // below the floor: not evidence yet
    const had = current[shape] ?? null;
    // A form people chose, often enough and well enough, is promoted. Checked
    // before demotion: when people have said what they want instead, that beats
    // falling back to the verbatim default.
    const promoted = scored
      .filter((p) => p.chosen >= FORM_OBSERVATION_FLOOR && p.mean >= FORM_PROMOTE_THRESHOLD)
      .reduce<PairEvidence | null>((a, b) => (a === null || b.mean > a.mean ? b : a), null);
    if (promoted) {
      if (had !== promoted.form) {
        next[shape] = promoted.form;
        moves.push({ shape, from: had, to: promoted.form, because: promoted });
      }
      continue;
    }
    const demoted = scored.find((p) => p.mean <= FORM_DEMOTE_THRESHOLD && p.form !== FALLBACK_FORM);
    if (demoted) {
      if (had !== FALLBACK_FORM) {
        next[shape] = FALLBACK_FORM;
        moves.push({ shape, from: had, to: FALLBACK_FORM, because: demoted });
      }
      continue;
    }
    // Every scored pair for this shape is above the threshold: lift a prior demotion.
    if (had !== null) {
      const best = scored.reduce((a, b) => (b.mean > a.mean ? b : a));
      delete next[shape];
      moves.push({ shape, from: had, to: null, because: best });
    }
  }
  return { next, moves };
}

/** Every form_choice observation journalled on this surface. */
export function readFormChoices(): Rec[] {
  const out: Rec[] = [];
  for (const raw of readParticipation("interactorObservation_write")) {
    if (raw && typeof raw === "object" && !Array.isArray(raw) && (raw as Rec)["type"] === "form_choice") out.push(raw as Rec);
  }
  return out;
}

/**
 * The pass. Reads the exposure corpus the importance learner reads, scores it
 * for form, and returns what should be written. Never writes.
 */
export function runFormLearningPass(): FormLearningPass {
  const current = getRenderPolicy().learnedFormByShape ?? {};
  // The same corpus boundary as the importance pass: test-origin lines are excluded and counted.
  const corpus = readExposureCorpusWithExclusions();
  const { pairs, skipped } = aggregateFormEvidence([...(corpus.records as readonly Rec[]), ...readFormChoices()]);
  const { next, moves } = decideLearnedForms(pairs, current);
  const changed = moves.length > 0;
  const scoredPairs = pairs.filter((p) => p.successes + p.failures >= FORM_OBSERVATION_FLOOR).length;
  const reason = changed
    ? moves.map((m) => `${m.shape}: ${m.from ?? "(default)"} -> ${m.to ?? "(lifted)"} on ${m.because.form} mean=${m.because.mean} n=${m.because.successes + m.because.failures}`).join("; ")
    : pairs.length === 0
      ? "no exposure outcome carried a form read from the DOM; nothing to score"
      : scoredPairs === 0
        ? `${pairs.length} pair(s) seen, none at the floor of ${FORM_OBSERVATION_FLOOR}; nothing moves`
        : `${scoredPairs} pair(s) at the floor, all consistent with the current table; converged`;
  const reasonWithExclusions = `${reason}. ${exclusionClause(corpus.excluded)}`;
  return { changed, learnedFormByShape: next, moves, evidence: pairs, skipped, reason: reasonWithExclusions, learnerId: FORM_LEARNER_ID };
}
