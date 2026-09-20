/**
 * The importance LEARNER — the second half of the operator's directive: "the
 * system should always show what it thinks is most important, and it should
 * learn what is important from what it shows."
 *
 * The first half is `src/importance.ts` (a pure ordering function) plus the
 * `renderPolicy.importanceWeights` impulse the `uiQuestion` reader consults on
 * every request. That half is honest and inert: the weights never move, so the
 * ranking cannot be wrong in a way anything notices. This module is the part
 * that makes the ranking answerable to the world — it reads the exposure corpus
 * (what was actually put on screen and what became of it) and writes an updated
 * weight table back through `renderPolicy_write`, which the ranker then reads at
 * use time with NO rebuild, NO restart and NO code change. That path — evidence
 * to impulse to next read — is the whole law-1 requirement of a learner, and
 * test/importance-learn.test.ts is its falsifier.
 *
 * ─── WHAT IS SCORED, AND WHAT IS DELIBERATELY NOT ────────────────────────────
 *
 * NEVER SHOWN MOVES NOTHING. A solicitation that was never in a visible slice
 * produces no record at all (ui/src/lib/exposure.ts states the same rule on the
 * producing side), and a KIND with no records keeps its weight byte-identical.
 * This is the single most important line in the file: a learner that treats
 * absence of evidence as negative evidence learns what it already put on top,
 * confirms its own ranking, and makes the whole feature fraudulent. The
 * falsifier is named for exactly that
 * ("(c) records for a kind that was never shown move nothing").
 *
 * A COMPLAINT IS NOT A VERDICT ON IMPORTANCE. "complained" means the person
 * found the item hard to see, hard to understand, or wrong — a statement about
 * the PRESENTATION. Scoring it as unimportance would teach the surface to hide
 * whatever people struggle with, which is the inverse of the goal. Complaints
 * are counted, reported in the write's reason so they stay visible, and excluded
 * from alpha and from beta alike. If a panel's only recorded outcome is a
 * complaint it contributes nothing at all.
 *
 * DECLINED IS AN ACT, AND IT IS NOT AN ANSWER. Declining is a person engaging
 * and saying "not this" — weaker evidence of importance than being ignored is,
 * and not the same thing. It counts as an OPPORTUNITY that produced no answer
 * (beta), never as a success, and its own count is kept and reported separately
 * so a later variant can weigh it differently without re-deriving it from a
 * collapsed number.
 *
 * ─── THE UNIT OF EVIDENCE IS A PANEL, NOT A TICK ─────────────────────────────
 *
 * `ExposureLedger.tick` emits a `shown_not_acted` event on every accepted
 * refresh after the first, so one ignored panel in a long session produces
 * dozens of events while an answer produces one. Counting events would let beta
 * swamp alpha for any long-lived kind, and would let a person manufacture
 * negative evidence by leaving a tab open. Evidence is therefore aggregated per
 * DISTINCT panel id: a panel's fate is the unit, and its fate is decided by the
 * strongest act recorded against it (answered > declined > ignored).
 *
 * ─── KEYED ON KIND ONLY, BECAUSE KIND IS THE ONLY POPULATED KEY ──────────────
 *
 * Kind is present on every panel in the live corpus (450 panels, 8 kinds) and is
 * resolved from the panel store at write time (src/store.ts `recordObservation`,
 * `panelKind`), so it is demonstrably there at the moment of selection. Nothing
 * else about a solicitation is: `importance` is 240 "high" to 10 "medium" and
 * cannot discriminate, and the presentation conditions are populated only when
 * the browser could read them. A key populated on a fraction of records makes a
 * pipeline LOOK conditioned while it is not — this project lost a great deal of
 * time to a path store keyed by goal-text hash while `state_signature` was
 * absent from all 13,423 rows — so an unresolvable kind is SKIPPED and counted,
 * never bucketed.
 *
 * ─── THE UPDATE IS ANCHORED, BOUNDED, AND CANNOT REACH ZERO ─────────────────
 *
 * Anchored: the target is computed from a BASE — the weight table of the most
 * recent assignment this learner did not make (an operator's, or the compiled
 * default when there is none) — not from the value currently in force. A target
 * relative to the current value would re-apply the same old evidence on every
 * pass and compound geometrically: fifty writes each citing the same three
 * answers, a weight doubling with no new evidence. Anchoring makes the pass a
 * fixed-point iteration: it converges, it is idempotent once converged (the
 * policy writer then refuses the no-op, which is the honest outcome, not an
 * error), and an operator's hand assignment becomes the new anchor instead of
 * something the learner drags back toward defaults.
 *
 * Bounded: one pass moves a weight at most `MAX_STEP_FRACTION` of the distance
 * to its target, and a target is at most `2 x base`. One batch can therefore
 * never reorder the wall on its own.
 *
 * Floored: no weight may go below `MIN_KIND_WEIGHT`, and a kind sitting at the
 * floor can still climb (the floor is also the base's stand-in when the base is
 * zero). A kind driven to weight 0 would be permanently invisible, could never
 * be shown, could therefore never produce an outcome, and so could never earn
 * its way back — the same irreversibility defect as a type scale that can be
 * flattened and not recovered. That trap is not rebuilt here.
 *
 * ─── WHAT IS NOT LEARNED YET, STATED SO SILENCE IS NOT MISTAKEN FOR A VERDICT ─
 *
 * `agePerDay`, `unansweredBoost` and `declaredImportance` are copied through
 * UNTOUCHED. They are not keyed on anything the exposure corpus populates per
 * record today, and moving them on kind evidence would be attributing an effect
 * to a dimension that produced none.
 */

import {
  getRenderPolicy,
  writeRenderPolicy,
  isExposureObservation,
  type ExposureOutcome,
  type Observation,
  type ObservationType,
  type RenderPolicy,
  type RenderPolicyWrite,
} from "./store.ts";
import { readParticipation } from "./participation-journal.ts";
import { DEFAULT_IMPORTANCE_WEIGHTS, type ImportanceWeights } from "./importance.ts";

/**
 * Who the learner is, in the impulse's `assignedBy`. Named as an activity
 * because that is what this behaviour should be selected and graded as (law 2);
 * until an activity owns the cadence, the name at least makes every learned
 * revision attributable to the learner rather than to an anonymous writer, and
 * it is the marker `anchorWeights` uses to tell a learned revision from a human
 * one.
 */
export const IMPORTANCE_LEARNER_ID = "activity:importance_learn@human-surface-vessel";

/**
 * The documented bound on one batch: a pass closes at most a quarter of the
 * distance between the weight in force and its target. Chosen so that a single
 * pass cannot invert the default order's smallest gap (gap_pending_verification
 * 4 vs gap_needs_localization 6 — a quarter-step from 4 toward its ceiling of 8
 * reaches 5, still below 6), so reordering takes repeated, independent evidence.
 */
export const MAX_STEP_FRACTION = 0.25;

/** The floor no number of negative observations may breach. See the header. */
export const MIN_KIND_WEIGHT = 0.1;

/**
 * Laplace prior on each kind: alpha starts at 1 and beta starts at 1, the
 * project's existing alpha/beta idiom (`context_thompson_scores.alpha/beta`;
 * `variant_performance_metrics.thompson_alpha/beta`). One answered panel
 * therefore yields a posterior mean of 2/3 rather than 1, so a single
 * observation cannot swing an order — confidence is representable instead of
 * being a bare average that reads 100% off one record.
 *
 * NO CODE WAS REUSABLE for this. activity-api carries `betaSample`
 * (repos/activity-api/src/routes/activities.scoring.ts:113), but it lives in a
 * different vessel's process (not importable here), and it SAMPLES — a sampled
 * weight would make the impulse nondeterministic and the falsifiers unwritable.
 * The idiom is reused; the code is not.
 */
export const PRIOR_ALPHA = 1;
export const PRIOR_BETA = 1;

/** What one kind's evidence adds up to. Every count is kept distinct. */
export interface KindEvidence {
  readonly kind: string;
  /** Distinct panels of this kind with an answer recorded. Feeds alpha. */
  readonly answeredPanels: number;
  /** Distinct panels declined and never answered. Feeds beta, never alpha. */
  readonly declinedPanels: number;
  /** Distinct panels shown again with no act recorded. Feeds beta. */
  readonly ignoredPanels: number;
  /** Distinct panels complained about. Feeds NEITHER — a presentation verdict. */
  readonly complainedPanels: number;
  /**
   * How many of this kind's counted opportunities came from a MACHINE-INFERRED
   * outcome (`shown_not_acted`) rather than from an act a person performed.
   * Reader of `Observation.inferred`. Reported in the write's reason so a weight
   * that fell mostly on inference is not mistaken for one people decided.
   */
  readonly inferredOpportunities: number;
  /**
   * Acts that addressed ONE ASK rather than the whole solicitation. Reader of
   * `Observation.outcomeScope`. Kept visible because `questionView` reads
   * `declined` only when there is no ask id, so a per-ask decline is written
   * into feedback and never read back as a decline — a weight moved by ask-scoped
   * acts rests on evidence the panel state does not show.
   */
  readonly askScopedActs: number;
  readonly alpha: number;
  readonly beta: number;
  /** alpha / (alpha + beta) — the posterior mean, not a sample. */
  readonly posteriorMean: number;
}

/** One weight that moved, with everything needed to replay the decision. */
export interface WeightMove {
  readonly kind: string;
  readonly from: number;
  readonly to: number;
  readonly base: number;
  readonly target: number;
  readonly posteriorMean: number;
}

export interface LearningPass {
  /** The complete weight table to write. Untouched kinds are carried verbatim. */
  readonly weights: ImportanceWeights;
  readonly evidence: readonly KindEvidence[];
  readonly moves: readonly WeightMove[];
  readonly skipped: {
    /** Outcome records whose panel id matched no panel, so kind was unknown. */
    readonly unresolvedKind: number;
    /** Records in the corpus that were not outcome records at all. */
    readonly notAnOutcome: number;
    /** Panels whose only recorded outcome was a complaint. */
    readonly complaintOnlyPanels: number;
    /** Exposure ticks whose scan FAILED: measurement broken, not evidence. */
    readonly failedScans: number;
    /**
     * `shown_not_acted` records that could not demonstrate REPETITION — an
     * `exposureCount` below 2, or none at all. Being shown once and not yet
     * answered is not evidence of anything, so these are skipped rather than
     * counted as opportunities. Reader of `Observation.exposureCount`.
     */
    readonly shownOnceOrUnknown: number;
    /**
     * Outcomes naming a panel that no exposure tick in this corpus ever put on
     * screen. These are the "never shown" records, refused against the tick
     * witness rather than against the producer's own exposure count.
     */
    readonly uncorroborated: number;
  };
  /**
   * Distinct renderer bundles the corpus spans, read from the verbatim
   * `body.renderer_bundle` the producer sent. Reported because weights learned
   * across two different renderers were learned from two different
   * presentations, and a surface that changed under the evidence is a fact a
   * reader of this reason needs.
   */
  readonly rendererBundles: readonly string[];
  /** The evidence, in words, for the impulse's `reason` field. */
  readonly reason: string;
}

/**
 * A corpus record, as loosely as it can honestly be typed. The journal is read
 * back as `unknown[]`, and a line written by a future author (or a
 * hand-appended one) must not be able to crash a pass.
 */
type CorpusRecord = Partial<Observation> & Record<string, unknown>;

const OUTCOMES: readonly ExposureOutcome[] = [
  "answered",
  "declined",
  "complained",
  "shown_not_acted",
];

function isOutcome(v: unknown): v is ExposureOutcome {
  return typeof v === "string" && (OUTCOMES as readonly string[]).includes(v);
}

/** Only finite numbers; a NaN weight would claim a weight that scores as 0. */
function finite(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/** Round to 4 decimals so a converged pass reaches an exact fixed point. */
function round4(v: number): number {
  return Math.round(v * 10_000) / 10_000;
}

/**
 * Read the durable exposure corpus.
 *
 * The journal file, not `recentObservations()`: the in-memory ring is capped at
 * 500 and evaporates with the process, and a learner reading it would train on a
 * window it cannot bound (falsifier (f) asserts a learned weight survives a
 * fresh process).
 */
export function readExposureCorpus(): CorpusRecord[] {
  const out: CorpusRecord[] = [];
  for (const raw of readParticipation("interactorObservation_write")) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const rec = raw as CorpusRecord;
    if (typeof rec.type !== "string") continue;
    if (!isExposureObservation(rec.type as ObservationType)) continue;
    out.push(rec);
  }
  return out;
}

/**
 * How healthy the measurement behind this corpus was. An exposure tick whose
 * scan FAILED means the reporter could not measure what was on screen — it is
 * not an empty slice, and it is reported rather than silently treated as
 * "nothing was shown". Reader of `Observation.scanStatus`.
 */
export function corpusHealth(records: readonly CorpusRecord[]): {
  failedScans: number;
  rendererBundles: string[];
} {
  let failedScans = 0;
  const bundles = new Set<string>();
  for (const rec of records) {
    // Provenance, read out of the verbatim body the producer sent.
    const body = rec.body;
    const bundle = body && typeof body === "object" ? body["renderer_bundle"] : undefined;
    if (typeof bundle === "string" && bundle.length > 0) bundles.add(bundle);
    if (rec.type !== "exposure") continue;
    const status = rec.scanStatus ?? rec["scan_status"];
    if (status === "failed") failedScans += 1;
  }
  return { failedScans, rendererBundles: [...bundles].sort() };
}

type Fate = "answered" | "declined" | "ignored" | "complaint_only";

/**
 * A panel's fate from all of its outcome records: the strongest act wins.
 * `answered` beats `declined` beats `ignored`; a complaint alone leaves the
 * panel with no fate that scores.
 */
function panelFate(outcomes: readonly ExposureOutcome[]): Fate {
  if (outcomes.includes("answered")) return "answered";
  if (outcomes.includes("declined")) return "declined";
  if (outcomes.includes("shown_not_acted")) return "ignored";
  return "complaint_only";
}

/**
 * Fold the corpus into per-kind evidence.
 *
 * Aggregation is per distinct panel id (see the header): a tick flood cannot
 * manufacture negatives. A record whose `panelKind` is null/absent is skipped
 * and counted — never bucketed as "unknown".
 */
export function aggregateByKind(records: readonly CorpusRecord[]): {
  evidence: KindEvidence[];
  skipped: {
    unresolvedKind: number;
    notAnOutcome: number;
    complaintOnlyPanels: number;
    shownOnceOrUnknown: number;
    uncorroborated: number;
  };
} {
  let unresolvedKind = 0;
  let notAnOutcome = 0;
  let shownOnceOrUnknown = 0;

  interface Act {
    readonly outcome: ExposureOutcome;
    readonly inferred: boolean;
    readonly askScoped: boolean;
  }
  // kind -> panelId -> acts recorded against that panel
  const byKind = new Map<string, Map<string, Act[]>>();

  // WHICH PANELS THIS CORPUS CAN ACTUALLY SHOW WERE ON SCREEN.
  //
  // Built from the exposure TICKS, which carry the measured slice in
  // body.visible_in_viewport, and consulted before any outcome is allowed to
  // move a weight. Without this, "never shown" could move a weight — verified
  // before this change: an exposure_outcome naming a panel that no tick ever
  // listed was accepted and scored, in both directions, 47 of 47 times, and a
  // self-reported exposure_count of 7 was taken at face value. The repetition
  // guard below reads a number the PRODUCER supplies, and a channel's own
  // reporting is not evidence about the channel; the tick record is the
  // independent witness, and it was already being persisted unread.
  //
  // Corroboration is deliberately by identity, not by count: a producer may
  // legitimately report an outcome for a panel shown in an earlier session
  // whose ticks are in the same corpus, but it may never invent an id nothing
  // ever displayed. A panel absent from every tick is skipped and COUNTED, so
  // a corpus that is all outcomes and no ticks reports itself as such instead
  // of silently teaching the ranker whatever it was handed.
  const shownPanelIds = new Set<string>();
  for (const rec of records) {
    if (rec.type !== "exposure") continue;
    const slice = (rec.body as { visible_in_viewport?: unknown } | undefined)?.visible_in_viewport;
    if (!Array.isArray(slice)) continue;
    for (const entry of slice) {
      const id = typeof entry === "string"
        ? entry
        : (entry as { panel_id?: unknown; solicitation_id?: unknown } | null)?.panel_id
          ?? (entry as { solicitation_id?: unknown } | null)?.solicitation_id;
      if (typeof id === "string" && id.length > 0) shownPanelIds.add(id);
    }
  }
  let uncorroborated = 0;

  for (const rec of records) {
    if (rec.type !== "exposure_outcome") {
      notAnOutcome += 1;
      continue;
    }
    const outcome = isOutcome(rec.outcome) ? rec.outcome : undefined;
    const panelId = typeof rec.panelId === "string" && rec.panelId.length > 0 ? rec.panelId : undefined;
    if (!outcome || !panelId) {
      notAnOutcome += 1;
      continue;
    }
    // An outcome for a panel no tick in this corpus ever put on screen does not
    // move anything. This is the "never shown must not move a weight" rule
    // enforced against an INDEPENDENT witness rather than against the
    // producer's own claim.
    if (!shownPanelIds.has(panelId)) {
      uncorroborated += 1;
      continue;
    }
    const kind = typeof rec.panelKind === "string" && rec.panelKind.length > 0 ? rec.panelKind : null;
    if (kind === null) {
      unresolvedKind += 1;
      continue;
    }
    // "SHOWN REPEATEDLY and never acted on" is the negative signal, and the
    // repetition has to be DEMONSTRABLE. An ignored record that cannot show an
    // exposure count of at least 2 is skipped and counted: being shown once and
    // not yet answered is not evidence of anything, and accepting an absent
    // count would let a key nobody populated act as if it were populated.
    if (outcome === "shown_not_acted" && (finite(rec.exposureCount) ?? 0) < 2) {
      shownOnceOrUnknown += 1;
      continue;
    }
    let panelsOfKind = byKind.get(kind);
    if (!panelsOfKind) {
      panelsOfKind = new Map();
      byKind.set(kind, panelsOfKind);
    }
    const act: Act = {
      outcome,
      inferred: rec.inferred === true,
      askScoped: rec.outcomeScope === "ask",
    };
    const list = panelsOfKind.get(panelId);
    if (list) list.push(act);
    else panelsOfKind.set(panelId, [act]);
  }

  let complaintOnlyPanels = 0;
  const evidence: KindEvidence[] = [];
  for (const [kind, panelsOfKind] of [...byKind.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    let answeredPanels = 0;
    let declinedPanels = 0;
    let ignoredPanels = 0;
    let complainedPanels = 0;
    let inferredOpportunities = 0;
    let askScopedActs = 0;
    for (const acts of panelsOfKind.values()) {
      const outcomes = acts.map((a) => a.outcome);
      if (outcomes.includes("complained")) complainedPanels += 1;
      // Read, not merely stored: how much of this kind's evidence a machine
      // inferred, and how much of it addressed one ask rather than the whole
      // solicitation.
      if (acts.some((a) => a.inferred && a.outcome === "shown_not_acted")) inferredOpportunities += 1;
      if (acts.some((a) => a.askScoped)) askScopedActs += 1;
      switch (panelFate(outcomes)) {
        case "answered":
          answeredPanels += 1;
          break;
        case "declined":
          declinedPanels += 1;
          break;
        case "ignored":
          ignoredPanels += 1;
          break;
        case "complaint_only":
          complaintOnlyPanels += 1;
          break;
      }
    }
    const alpha = PRIOR_ALPHA + answeredPanels;
    const beta = PRIOR_BETA + declinedPanels + ignoredPanels;
    // A kind with nothing but complaints has no scoring evidence at all, so it
    // must not appear here: appearing would move its weight toward the prior's
    // 0.5 posterior purely because somebody complained.
    if (answeredPanels + declinedPanels + ignoredPanels === 0) continue;
    evidence.push({
      kind,
      answeredPanels,
      declinedPanels,
      ignoredPanels,
      complainedPanels,
      inferredOpportunities,
      askScopedActs,
      alpha,
      beta,
      posteriorMean: alpha / (alpha + beta),
    });
  }

  return {
    evidence,
    skipped: { unresolvedKind, notAnOutcome, complaintOnlyPanels, shownOnceOrUnknown, uncorroborated },
  };
}

/**
 * The BASE the target is anchored to: the `byKind` table of the most recent
 * journaled assignment this learner did not make, or the compiled default when
 * there is none.
 *
 * Reconstructed by replaying the policy journal rather than kept as separate
 * state, because a second store of "what the base was" is a thing that can go
 * stale against the journal that actually decides the policy.
 */
export function anchorWeights(): { byKind: Record<string, number>; source: string } {
  let found: { byKind: Record<string, number>; source: string } | null = null;
  // The weight table the PREVIOUS journaled line carried, whoever wrote it.
  let previous: Record<string, number> = DEFAULT_IMPORTANCE_WEIGHTS.byKind;
  const sameTable = (a: Record<string, number>, b: Record<string, number>): boolean =>
    JSON.stringify(Object.entries(a).sort(([x], [y]) => x.localeCompare(y))) ===
    JSON.stringify(Object.entries(b).sort(([x], [y]) => x.localeCompare(y)));

  for (const raw of readParticipation("renderPolicy_write")) {
    const p = raw as Partial<RenderPolicy> | null;
    if (!p || typeof p !== "object") continue;
    const table = p.importanceWeights?.byKind;
    if (!table || typeof table !== "object" || Array.isArray(table)) continue;
    const clean: Record<string, number> = {};
    for (const [k, v] of Object.entries(table)) {
      const n = finite(v);
      if (n !== undefined) clean[k] = n;
    }
    if (Object.keys(clean).length === 0) continue;

    // A NON-LEARNER LINE IS THE ANCHOR ONLY IF IT ACTUALLY MOVED THE WEIGHTS.
    // `writeRenderPolicy` journals the WHOLE policy, so an operator flipping
    // `presentation` — or a surfaceIntent patch changing a font token — emits a
    // snapshot that carries the LEARNER's current byKind verbatim. Adopting
    // that as the human base would let each unrelated write ratchet the ceiling
    // to twice a table that already contains the learning, which is the
    // compounding this anchor exists to prevent, re-entering by a side door.
    // Known and accepted edge: an operator who re-affirms the learned numbers
    // verbatim does not re-anchor, because nothing in the journal distinguishes
    // that from a write about something else.
    if (p.assignedBy !== IMPORTANCE_LEARNER_ID && !sameTable(clean, previous)) {
      // Last such line wins: each journal line is a whole snapshot.
      found = {
        byKind: clean,
        source: `renderPolicy revision ${p.revision ?? "?"} assigned by ${p.assignedBy ?? "an unnamed author"}`,
      };
    }
    previous = clean;
  }
  return (
    found ?? {
      byKind: DEFAULT_IMPORTANCE_WEIGHTS.byKind,
      source: "DEFAULT_IMPORTANCE_WEIGHTS (no human assignment is journaled)",
    }
  );
}

/**
 * The pure update. Deterministic in `(records, current, base)` — no clock, no
 * I/O, no sampling — so a pass can be replayed against a past corpus to ask why
 * a weight moved.
 */
export function learnImportanceWeights(
  records: readonly CorpusRecord[],
  current: ImportanceWeights,
  base: { byKind: Record<string, number>; source: string },
): LearningPass {
  const { evidence, skipped } = aggregateByKind(records);
  const { failedScans, rendererBundles } = corpusHealth(records);

  // START FROM THE TABLE IN FORCE, COPIED VERBATIM. `writeRenderPolicy`
  // replaces a supplied map WHOLLY rather than merging keys (store.ts), so a
  // partial table would silently drop every kind without evidence and rescore
  // it at the neutral default. Untouched entries are copied, never recomputed
  // through any float path, so falsifier (c)'s byte-identical assertion holds.
  const nextByKind: Record<string, number> = { ...current.byKind };
  const moves: WeightMove[] = [];

  for (const e of evidence) {
    const anchor = base.byKind[e.kind];
    // A kind the base does not name: fall back to the value in force, then to
    // the floor. Never to 0, and never to a hidden constant.
    const baseWeight = Math.max(0, finite(anchor) ?? finite(current.byKind[e.kind]) ?? MIN_KIND_WEIGHT);
    const ceiling = Math.max(2 * baseWeight, MIN_KIND_WEIGHT);
    const target = Math.min(ceiling, Math.max(MIN_KIND_WEIGHT, baseWeight * 2 * e.posteriorMean));
    const from = finite(current.byKind[e.kind]) ?? baseWeight;
    const to = Math.max(MIN_KIND_WEIGHT, round4(from + MAX_STEP_FRACTION * (target - from)));
    if (to === from) continue;
    nextByKind[e.kind] = to;
    moves.push({
      kind: e.kind,
      from,
      to,
      base: round4(baseWeight),
      target: round4(target),
      posteriorMean: round4(e.posteriorMean),
    });
  }

  const parts = moves.map((m) => {
    const e = evidence.find((x) => x.kind === m.kind);
    const counts = e
      ? `${e.answeredPanels} answered / ${e.declinedPanels} declined / ${e.ignoredPanels} shown-not-acted` +
        (e.complainedPanels > 0 ? ` (+${e.complainedPanels} complained, excluded)` : "") +
        (e.inferredOpportunities > 0
          ? `, of which ${e.inferredOpportunities} opportunit${e.inferredOpportunities === 1 ? "y is" : "ies are"} machine-inferred rather than an act a person performed`
          : "") +
        (e.askScopedActs > 0 ? `, ${e.askScopedActs} act(s) addressed one ask rather than the whole solicitation` : "")
      : "no counts";
    return `${m.kind}: ${counts} over distinct solicitations, posterior ${m.posteriorMean}, base ${m.base} anchored on ${base.source}, target ${m.target}, ${m.from} -> ${m.to}`;
  });

  const reason =
    moves.length === 0
      ? `no weight moved: ${evidence.length} kind(s) carried scoring evidence and every one is already at its target. ` +
        `Skipped: ${skipped.unresolvedKind} outcome(s) whose panel id resolved to no kind, ` +
        `${skipped.complaintOnlyPanels} panel(s) whose only outcome was a complaint, ` +
        `${skipped.notAnOutcome} corpus record(s) that were not outcomes, ` +
        `${skipped.shownOnceOrUnknown} ignored record(s) that could not demonstrate a second presentation, ` +
        `${skipped.uncorroborated} outcome(s) for a panel no exposure tick showed, ` +
        `${failedScans} failed exposure scan(s).`
      : `learned from what was shown. ${parts.join("; ")}. ` +
        `Bound: no weight moves more than ${MAX_STEP_FRACTION} of the way to its target in one pass, ` +
        `floor ${MIN_KIND_WEIGHT} (a zero-weight kind could never be shown again and so could never earn its way back). ` +
        `Not scored: ${skipped.complaintOnlyPanels} panel(s) whose only outcome was a complaint ` +
        `(a complaint is about presentation, not importance), ` +
        `${skipped.unresolvedKind} outcome(s) whose panel id resolved to no kind, ` +
        `${skipped.notAnOutcome} corpus record(s) that were not outcomes, ` +
        `${skipped.shownOnceOrUnknown} ignored record(s) that could not demonstrate a second presentation ` +
        `(shown once and not yet answered is not evidence), ` +
        `${skipped.uncorroborated} outcome(s) for a panel no exposure tick showed ` +
        `(never shown moves nothing, checked against the tick and not against the reported count), ` +
        `${failedScans} failed exposure scan(s) (measurement broken, not an empty slice). ` +
        `Corpus spans renderer bundle(s): ${rendererBundles.length > 0 ? rendererBundles.join(", ") : "none recorded"}. ` +
        `Kinds with no records were not touched: never shown is not a negative outcome.`;

  return {
    weights: { ...current, byKind: nextByKind },
    evidence,
    moves,
    skipped: { ...skipped, failedScans },
    rendererBundles,
    reason,
  };
}

/**
 * Re-entrancy guard. `writeRenderPolicy` appends to the journal and emits a
 * `renderPolicy` event; no listener in this vessel records an observation, so a
 * pass cannot currently trigger a pass. The flag is here so that a future
 * listener which DOES cannot turn one outcome into an unbounded cascade of
 * policy revisions — the failure would be silent and would look like learning.
 */
let passRunning = false;

export interface PassResult extends RenderPolicyWrite {
  readonly pass: LearningPass;
  /** True when the corpus held nothing that scores, so no write was attempted. */
  readonly noEvidence: boolean;
  /** True when a pass was already running (see the guard above). */
  readonly reentered?: boolean;
}

/**
 * Run one learning pass: read the durable corpus, compute, write the impulse.
 *
 * CALLED FROM `src/routes/impulses.ts` on every accepted `exposure_outcome`
 * record — the single write path for the corpus, and the moment new evidence
 * exists. An exported-but-uncalled learner would be the IMPLEMENTED_DORMANT
 * class: code that reads correctly and runs never.
 *
 * A `changed: false` result with a refusal is the CONVERGED case, not an error:
 * the weights the evidence implies are already in force, and
 * `writeRenderPolicy` declines to manufacture a revision for a no-op.
 */
export function runImportanceLearningPass(): PassResult {
  const current = getRenderPolicy().importanceWeights;
  if (passRunning) {
    const idle: LearningPass = {
      weights: current,
      evidence: [],
      moves: [],
      skipped: {
        unresolvedKind: 0,
        notAnOutcome: 0,
        complaintOnlyPanels: 0,
        failedScans: 0,
        shownOnceOrUnknown: 0,
        uncorroborated: 0,
      },
      rendererBundles: [],
      reason: "a learning pass was already running; this trigger was dropped rather than nested",
    };
    return {
      changed: false,
      policy: getRenderPolicy(),
      changedFields: [],
      refusal: null,
      pass: idle,
      noEvidence: true,
      reentered: true,
    };
  }
  passRunning = true;
  try {
    const records = readExposureCorpus();
    const pass = learnImportanceWeights(records, current, anchorWeights());
    if (pass.moves.length === 0) {
      // Nothing moved. NOT written: a write that moves no field would be refused
      // anyway, and attempting it would put a "learned" revision claim in the
      // journal for a pass that learned nothing.
      return {
        changed: false,
        policy: getRenderPolicy(),
        changedFields: [],
        refusal: null,
        pass,
        noEvidence: pass.evidence.length === 0,
      };
    }
    const write = writeRenderPolicy({
      importanceWeights: { byKind: pass.weights.byKind },
      assignedBy: IMPORTANCE_LEARNER_ID,
      reason: pass.reason,
    });
    return { ...write, pass, noEvidence: false };
  } finally {
    passRunning = false;
  }
}
