/**
 * In-memory store for the substrate's human surface.
 *
 * Record semantics are inherited verbatim from stateful-ui-vessel, which this
 * vessel replaces:
 *   - panels       (substrate-authored UI artifacts)
 *   - feedback     (operator answers/reactions/dismisses on asks)
 *   - observations (behavioural telemetry — click/dwell/focus/scroll)
 *   - events       (interactorEvent — structured for upstream learning)
 *   - asserts      (interactorAssertion — operator-typed substrate-bound facts)
 *   - attachments  (interactorAttachment — operator-supplied references)
 *
 * Every record carries `visibility: "public" | "operator_only"`. Public records
 * may flow into the substrate's LLM context; operator_only records stay in the
 * pool and downstream filters must redact them.
 *
 * Panels and feedback are journaled before acknowledgement; other records remain ephemeral.
 */

import { appendParticipation, readParticipation } from "./participation-journal.ts";
import { isSolicitation } from "./solicitation.ts";
import { DEFAULT_IMPORTANCE_WEIGHTS, type ImportanceWeights } from "./importance.ts";

export type AskType = "text" | "choice" | "number";
export type Visibility = "public" | "operator_only";

export interface Ask {
  id: string;
  prompt: string;
  type: AskType;
  choices?: string[];
}

export interface Panel {
  id: string;
  title: string;
  body: unknown;
  revision: number;
  kind: string;
  importance: string;
  asks?: Ask[];
  visibility: Visibility;
  createdAt: number;
  updatedAt: number;
}

export interface Feedback {
  id: string; // Added to uniquely identify feedback entries
  panelId: string;
  panelRevision?: number;
  askId?: string;
  value: unknown;
  kind: "answer" | "reaction" | "dismiss";
  visibility: Visibility;
  receivedAt: number;
}

/**
 * `exposure` and `exposure_outcome` join the behavioural telemetry types
 * because they ARE behavioural telemetry: what the surface put on screen, and
 * what the person then did with it. They travel on `interactorObservation`
 * rather than on a minted shape (law 3: the observation channel already
 * expresses them, and splitting it would give the learner two corpora to read).
 */
export type ObservationType =
  | "click"
  | "dwell"
  | "scroll"
  | "focus"
  | "exposure"
  | "exposure_outcome";

/**
 * The four states a SHOWN solicitation can end in, kept distinct here because
 * collapsing any pair destroys the signal the learner exists to use.
 * Mirrors `ui/src/lib/exposure.ts`'s `ExposureOutcome` — the producer's own
 * union — and is declared (not imported) because `src/` must not depend on the
 * browser bundle's module graph.
 */
export type ExposureOutcome = "answered" | "declined" | "complained" | "shown_not_acted";

export interface Observation {
  type: ObservationType;
  panelId?: string;
  askId?: string;
  durationMs?: number;
  position?: { x: number; y: number };
  visibility: Visibility;
  observedAt: number;
  /**
   * The KIND of the solicitation this observation is about, RESOLVED AT WRITE
   * TIME from the panel store — never copied from the browser's pointer, which
   * could claim anything, and never defaulted to a placeholder.
   *
   * `null` means the panel id named no panel this vessel holds, so the kind is
   * genuinely unknown. The learner keys on kind and SKIPS a null (reader:
   * src/importance-learn.ts `aggregateByKind`, which counts it into
   * `skipped.unresolvedKind` and reports the count in the write's reason). A
   * bucket called "unknown" would make the pipeline look conditioned on kind
   * while a share of its evidence was conditioned on nothing.
   *
   * READER: src/importance-learn.ts — the null check, and the per-kind fold
   * that keys on it (currently :351 and :364-377).
   */
  panelKind?: string | null;
  /** exposure_outcome only. READER: src/importance-learn.ts, folded by `panelFate` (currently :345, :305-310). */
  outcome?: ExposureOutcome;
  /**
   * Whether the act addressed the whole solicitation or one ask of it. Kept
   * because `questionView` reads `declined` only when there is no `askId`, so a
   * per-ask decline is written into feedback and never read back as a decline;
   * carrying the scope here keeps the two distinguishable in the evidence even
   * while that is true of the store.
   *
   * READER: src/importance-learn.ts — read off the record and counted into
   * `KindEvidence.askScopedActs`, which the learned revision reason states
   * (currently :373 and :396).
   */
  outcomeScope?: "panel" | "ask";
  /**
   * Presentation ticks this id was in the visible slice when the act happened.
   *
   * READER: src/importance-learn.ts (currently :361), which SKIPS a `shown_not_acted`
   * record that cannot show a count of at least 2 — the negative signal is
   * "shown REPEATEDLY and never acted on", and being shown once and not yet
   * answered is not evidence of anything.
   */
  exposureCount?: number;
  /**
   * True for `shown_not_acted` — the only outcome a machine infers.
   *
   * READER: src/importance-learn.ts (currently :372, :395), which count how many of a
   * kind's opportunities were inferred rather than performed and say so in the
   * learned revision reason, so a weight that fell on inference alone is not
   * mistaken for one people decided.
   */
  inferred?: boolean;
  /**
   * `exposure` only: "observed" or "failed". A failed scan means the reporter
   * could not measure what was on screen; it is NOT an empty slice, and the
   * learner reports the count rather than reading it as "nothing was shown"
   * (READER: src/importance-learn.ts `corpusHealth`, currently :292).
   */
  scanStatus?: "observed" | "failed";
  /**
   * The remainder of the producer's pointer, VERBATIM. The exposure record
   * carries fields no column here names (`visible_in_viewport[]`,
   * `renderer_bundle`, `candidates_total`, `unobservable[]`, …) and dropping
   * them would leave the corpus unable to answer "what conditions produced this
   * outcome" — the provenance half of the record. Nested under `body` (the
   * precedent is `InteractorEvent.body`) so it cannot collide with a column.
   *
   * READER: src/importance-learn.ts `corpusHealth` (currently :289), which reads `renderer_bundle` out of
   * it so the learned revision states which renderer(s) the evidence spans — a
   * weight learned across two presentations was learned from two surfaces.
   */
  body?: Record<string, unknown>;
}

export interface InteractorEvent {
  id: string;
  type: "click" | "dismiss" | "expand" | "collapse" | "focus" | "fetch";
  target?: string;
  panelId?: string;
  body?: Record<string, unknown>;
  visibility: Visibility;
  occurredAt: number;
}

export interface InteractorAssertion {
  id: string;
  kind: string;
  body: string;
  visibility: Visibility;
  assertedAt: number;
}

export interface InteractorAttachment {
  id: string;
  pointer: Record<string, unknown>;
  note?: string;
  visibility: Visibility;
  attachedAt: number;
}

const panels = new Map<string, Panel>();
const feedback: Feedback[] = [];
// Recent telemetry is bounded; durable response identity and question state must not expire with it.
const feedbackRecords = new Map<string, Feedback>();
const observations: Observation[] = [];
const events: InteractorEvent[] = [];
const asserts: InteractorAssertion[] = [];
const attachments: InteractorAttachment[] = [];
const MAX_HISTORY = 500;

type Listener = (event: { event: string; data: unknown }) => void;
const listeners = new Set<Listener>();

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function emit(event: string, data: unknown): void {
  for (const l of listeners) {
    try {
      l({ event, data });
    } catch {
      /* a broken listener must never break a write */
    }
  }
}

export function rid(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function asVisibility(v: unknown, fallback: Visibility): Visibility {
  return v === "public" || v === "operator_only" ? v : fallback;
}

export function upsertPanel(
  p: Omit<Panel, "createdAt" | "updatedAt" | "visibility" | "revision"> & {
    createdAt?: number;
    visibility?: Visibility;
  },
): Panel {
  const now = Date.now();
  const existing = panels.get(p.id);
  const stored: Panel = {
    ...p,
    revision: (existing?.revision ?? 0) + 1,
    visibility: asVisibility(p.visibility, "public"),
    createdAt: existing?.createdAt ?? p.createdAt ?? now,
    updatedAt: now,
  };
  if (existing && ["title", "body", "kind", "importance", "asks", "visibility"].every(key =>
    JSON.stringify(existing[key as keyof Panel]) === JSON.stringify(stored[key as keyof Panel]))) return existing;
  appendParticipation("uiPanel_write", stored);
  panels.set(p.id, stored);
  emit(existing ? "panel_updated" : "panel_added", stored);
  return stored;
}

export function listPanels(): Panel[] {
  return Array.from(panels.values()).sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * The stored panel for `id`, or undefined if this id has never been written.
 *
 * Exists so a write path can distinguish CREATION from UPDATE before it builds
 * the record: a field omitted from an update must fall back to what is already
 * stored, and a literal default ("Untitled", "") must only ever apply to a
 * genuine creation. Read by routes/impulses.ts (uiPanel_write / uiQuestion_write).
 */
export function getPanel(id: string): Panel | undefined {
  return panels.get(id);
}

export class ParticipationConflict extends Error {}

/**
 * The solicitation predicate lives in ./solicitation.ts and is re-exported here
 * so every existing importer of `store.isSolicitation` is unchanged. It moved
 * for one reason, stated in that file: this module now reads
 * `DEFAULT_IMPORTANCE_WEIGHTS` from ./importance.ts while building the initial
 * render policy, and importance.ts needs the predicate — a runtime cycle that
 * throws at import under one of the two load orders. One definition, no cycle.
 */
export { isSolicitation };

export function recordFeedback(
  f: Omit<Feedback, "id" | "receivedAt" | "visibility"> & { id?: string; visibility?: Visibility },
): Feedback {
  const visibility = asVisibility(f.visibility, "public");
  const previous = f.id ? feedbackRecords.get(f.id) : undefined;
  if (previous) {
    if (previous.panelId !== f.panelId || previous.panelRevision !== f.panelRevision ||
        previous.askId !== f.askId || previous.kind !== f.kind || previous.visibility !== visibility ||
        JSON.stringify(previous.value) !== JSON.stringify(f.value)) {
      throw new ParticipationConflict("This response id already belongs to a different contribution.");
    }
    return previous;
  }
  const panel = panels.get(f.panelId);
  // THREE distinct conditions, three distinct messages, deliberately NOT
  // collapsed. The collapsed form told a human who answered a live
  // `gap_needs_human` escalation at the correct revision that "the question
  // changed" — a statement that was simply false, and the worst kind of
  // false: it blames the artifact for the guard's own mistake. Collapsing
  // missing-panel into the informational branch reproduces exactly that
  // confabulation in a new coat, so each branch reports only what it knows.
  //
  // The branches were correct; the CONDITION that decided whether they ran at
  // all was not. All four used to sit inside `if (f.panelRevision !== undefined)`,
  // so a `uiFeedback` that simply omitted `panel_revision` skipped every check:
  // a bogus ask id was accepted, stored, and admitted into the current-revision
  // `answers` set that `questionView` treats as the completion oracle (observed:
  // validation/human-participation/asks-contract-probe.ts stored
  // askId="part-does-not-exist" at HTTP 200). The gating below is therefore
  // split by WHAT IS KNOWABLE, not by whether a revision happened to be sent:
  //
  //  - A revision COMPARISON is meaningless without a revision, and a caller who
  //    asserts a revision is asserting this panel is here — so missing-panel and
  //    revision-mismatch both stay conditional on `f.panelRevision !== undefined`.
  //  - Whenever this store HOLDS the panel, two facts are knowable with or without
  //    a revision: an ask id the panel does not contain is bogus, and an
  //    informational panel solicits nothing. Those run unconditionally.
  //  - When this store does NOT hold the panel and no revision was asserted, we
  //    accept. Do not "fix" that: this vessel holds 0 panels in deployment while
  //    the live panel corpus is served by another vessel, so feedback about an
  //    unknown panel is the ordinary cross-vessel (and legacy, revision-less)
  //    path. Refusing it would silently discard real human contributions.
  //
  // Precedence is preserved from the original: missing → informational →
  // revision mismatch → unknown part.
  if (f.panelRevision !== undefined && !panel) {
    throw new ParticipationConflict("That question is no longer available on this surface. Your draft has not been applied.");
  }
  if (panel) {
    if (!isSolicitation(panel)) {
      throw new ParticipationConflict("That panel is informational — nothing is being asked of you there, so there is nothing to respond to. Your draft has not been applied.");
    }
    if (f.panelRevision !== undefined && panel.revision !== f.panelRevision) {
      throw new ParticipationConflict("The question changed since you loaded it. Review the current version before responding; your draft has not been applied.");
    }
    if (f.askId !== undefined && !panel.asks?.some(ask => ask.id === f.askId)) {
      throw new ParticipationConflict("This question no longer contains the requested part.");
    }
  }
  const entry: Feedback = { ...f, id: f.id ?? rid("fdbk"), visibility, receivedAt: Date.now() };
  appendParticipation("uiFeedback_write", entry);
  feedbackRecords.set(entry.id, entry);
  feedback.push(entry);
  if (feedback.length > MAX_HISTORY) feedback.shift();
  emit("feedback_received", entry);
  return entry;
}

// Replay preserves original ids/times and never emits a new interaction.
// Legacy feedback without a revision remains evidence for the first panel version only.
for (const raw of readParticipation("uiPanel_write")) {
  const p = raw as Panel | null;
  if (p && typeof p.id === "string" && typeof p.title === "string" &&
      typeof p.kind === "string" && typeof p.createdAt === "number" && typeof p.updatedAt === "number") {
    panels.set(p.id, { ...p, revision: Number.isInteger(p.revision) && p.revision > 0 ? p.revision : 1 });
  }
}
for (const raw of readParticipation("uiFeedback_write")) {
  const f = raw as Feedback | null;
  if (f && typeof f.id === "string" && typeof f.panelId === "string" &&
      typeof f.receivedAt === "number" && ["answer", "reaction", "dismiss"].includes(f.kind) &&
      !feedbackRecords.has(f.id)) {
    feedbackRecords.set(f.id, f);
    feedback.push(f);
    if (feedback.length > MAX_HISTORY) feedback.shift();
  }
}

export function recentFeedback(limit = 50): Feedback[] {
  return [...feedback].sort((a, b) => b.receivedAt - a.receivedAt || a.id.localeCompare(b.id)).slice(0, limit);
}

export function questionView(panel: Panel) {
  const responses = [...feedbackRecords.values()].filter(f => f.panelId === panel.id);
  const current = responses.filter(f => (f.panelRevision ?? 1) === panel.revision);
  const answers = current.filter(f => f.kind === "answer");
  const wholeAnswer = answers.some(f => !f.askId);
  const answered = wholeAnswer || Boolean(panel.asks?.length && panel.asks.every(ask => answers.some(f => f.askId === ask.id)));
  const declined = current.some(f => f.kind === "dismiss" && !f.askId);
  return { ...panel, responses, answers, answered, declined };
}

/**
 * Which observation types are the exposure corpus. Exported because the route
 * that accepts them and the learner that reads them must agree with the writer
 * about the membership of this set, and three hand-kept copies of a list like
 * this one is how the three re-derived `isSolicitation` predicates diverged.
 */
export const EXPOSURE_OBSERVATION_TYPES = ["exposure", "exposure_outcome"] as const;

export function isExposureObservation(type: ObservationType): boolean {
  return (EXPOSURE_OBSERVATION_TYPES as readonly string[]).includes(type);
}

export function recordObservation(
  o: Omit<Observation, "observedAt" | "visibility" | "panelKind"> & { visibility?: Visibility },
): Observation {
  const exposure = isExposureObservation(o.type);
  const entry: Observation = {
    ...o,
    // Resolved HERE, from the store's own panels, at the moment of the write —
    // the only place the kind is a fact rather than a claim. Set only for the
    // exposure family so nothing suggests click/dwell telemetry carries a
    // populated kind when it does not.
    ...(exposure ? { panelKind: (o.panelId ? panels.get(o.panelId)?.kind : undefined) ?? null } : {}),
    visibility: asVisibility(o.visibility, "operator_only"),
    observedAt: Date.now(),
  };
  observations.push(entry);
  if (observations.length > MAX_HISTORY) observations.shift();
  // Journaled BEFORE acknowledgement, and only for the exposure family: this is
  // the learner's evidence, and the array above is a 500-entry ring that shifts
  // its oldest entry out. The ring is deliberately NOT repopulated from the
  // journal at init — it is a recent-telemetry view, and replaying a long
  // exposure corpus into it would evict live telemetry to no reader's benefit.
  // The learner reads the journal file itself (src/importance-learn.ts
  // `readExposureCorpus`), so its corpus is neither bounded by MAX_HISTORY nor
  // lost on restart.
  if (exposure) appendParticipation("interactorObservation_write", entry);
  emit("observation_recorded", entry);
  return entry;
}

export function recentObservations(limit = 50): Observation[] {
  return observations.slice(-limit).reverse();
}

export function recordEvent(
  e: Omit<InteractorEvent, "id" | "occurredAt" | "visibility"> & {
    id?: string;
    visibility?: Visibility;
  },
): InteractorEvent {
  const entry: InteractorEvent = {
    ...e,
    id: e.id ?? rid("evt"),
    visibility: asVisibility(e.visibility, "public"),
    occurredAt: Date.now(),
  };
  events.push(entry);
  if (events.length > MAX_HISTORY) events.shift();
  emit("event_recorded", entry);
  return entry;
}

export function recentEvents(limit = 50): InteractorEvent[] {
  return events.slice(-limit).reverse();
}

export function recordAssertion(
  a: Omit<InteractorAssertion, "id" | "assertedAt" | "visibility"> & {
    id?: string;
    visibility?: Visibility;
  },
): InteractorAssertion {
  const entry: InteractorAssertion = {
    ...a,
    id: a.id ?? rid("asn"),
    visibility: asVisibility(a.visibility, "operator_only"),
    assertedAt: Date.now(),
  };
  asserts.push(entry);
  if (asserts.length > MAX_HISTORY) asserts.shift();
  emit("assertion_recorded", entry);
  return entry;
}

export function recentAsserts(limit = 50): InteractorAssertion[] {
  return asserts.slice(-limit).reverse();
}

export function recordAttachment(
  a: Omit<InteractorAttachment, "id" | "attachedAt" | "visibility"> & {
    id?: string;
    visibility?: Visibility;
  },
): InteractorAttachment {
  const entry: InteractorAttachment = {
    ...a,
    id: a.id ?? rid("att"),
    visibility: asVisibility(a.visibility, "operator_only"),
    attachedAt: Date.now(),
  };
  attachments.push(entry);
  if (attachments.length > MAX_HISTORY) attachments.shift();
  emit("attachment_recorded", entry);
  return entry;
}

export function recentAttachments(limit = 50): InteractorAttachment[] {
  return attachments.slice(-limit).reverse();
}

export function counts(): Record<string, number> {
  return {
    panels: panels.size,
    feedback: feedback.length,
    observations: observations.length,
    events: events.length,
    assertions: asserts.length,
    attachments: attachments.length,
    intents: intents.length,
  };
}

/** Inputs for the substrate's state-signature integration. */
export interface SignatureInputs {
  recent_interactor_events_count: number;
  unanswered_asks_age_ms_p95: number;
  operator_assertion_pending_count: number;
  panels_open_count: number;
}

export function signatureInputs(): SignatureInputs {
  const now = Date.now();
  const recentWindow = now - 300_000;

  const recentEventsCount = events.reduce(
    (n, e) => (e.occurredAt >= recentWindow ? n + 1 : n),
    0,
  );

  const ages: number[] = [];
  let panelsOpen = 0;
  for (const p of panels.values()) {
    const view = questionView(p);
    const isOpen = !view.declined && !view.answered;
    if (isOpen) panelsOpen += 1;
    if (isOpen && isSolicitation(p)) {
      ages.push(now - p.updatedAt);
    }
  }
  ages.sort((a, b) => a - b);
  const p95 =
    ages.length === 0
      ? 0
      : (ages[Math.min(ages.length - 1, Math.floor(ages.length * 0.95))] ?? 0);

  const pendingAsserts = asserts.reduce(
    (n, a) =>
      a.visibility === "operator_only" && a.assertedAt >= recentWindow ? n + 1 : n,
    0,
  );

  return {
    recent_interactor_events_count: recentEventsCount,
    unanswered_asks_age_ms_p95: p95,
    operator_assertion_pending_count: pendingAsserts,
    panels_open_count: panelsOpen,
  };
}


/* ───────────────────────── render policy ─────────────────────────────────── */

/**
 * The documented default for `RenderPolicy.visibleSliceSize` — the starting
 * value of a learnable field, not a law. Exported so the reader's response and
 * the falsifiers can NAME it instead of each carrying a copy of the number
 * (a hand-copied default is the drift RENDER_POLICY_PATCH_KEYS exists to stop).
 * The rationale is on the field itself.
 */
export const DEFAULT_VISIBLE_SLICE_SIZE = 50;

/**
 * The shaped impulse that steers rendering.
 *
 * `formByShape` overrides the surface's built-in form heuristic for a given
 * impulse shape. The heuristic is not deleted — it becomes the PRIOR, used when
 * the policy is silent. That is the difference between a compiled decision and
 * a learnable one: with this in place a render choice has a counterfactual, so
 * it can be varied, graded, and replaced by a better arm.
 */
export interface RenderPolicy {
  /**
   * CSS custom properties applied to :root at use time.
   *
   * This is what makes a legibility fix VISIBLE without a rebuild. The token
   * values ship in the bundle as defaults; an override here wins, is read on
   * the live cadence, and repaints the running surface. A gap the substrate
   * detected can therefore be fixed while someone is looking at the thing.
   */
  readonly tokenOverrides: Record<string, string>;
  readonly formByShape: Record<string, string>;
  readonly maxPreviewChars: number | null;
  readonly ledgerDefaultExpanded: boolean;
  /**
   * Which presentation variant of the repertoire this surface should render:
   * "onepage" (v2 single-viewport workbench) or "stacked" (v1 order). Selected
   * through the impulse so a selection activity — not a rebuild — chooses the
   * variant. The browser adopts it at page load, never mid-session: a person's
   * open work is not reflowed underneath them (the adoption boundary the
   * repertoire's versioning rules require).
   */
  readonly presentation: "onepage" | "stacked";
  /**
   * The weights that ORDER what the surface shows.
   *
   * This is the law-1 half of "the system should always show what it thinks is
   * most important, and it should learn what is important from what it shows".
   * Every number that decides an order arrives HERE, on the impulse, and is read
   * at request time by the `uiQuestion` reader
   * (src/routes/impulses.ts:`getRenderPolicy().importanceWeights` handed to
   * `rankPanels`). Nothing at the ranking site imports a weight table, so a
   * learner can change what the surface considers important by writing this
   * impulse — no rebuild, no restart, no code change. The cautionary instance of
   * the opposite is in this same vessel: `ui-view.ts`'s COMPONENT_COUNTS is an
   * `as const` literal, so the only grader of the surface reads fiction.
   *
   * Defaults to `DEFAULT_IMPORTANCE_WEIGHTS` and is POPULATED, never null: a
   * reader of this impulse must be able to see the weights actually in force. A
   * null meaning "whatever the module default is" would make the impulse look
   * conditioned while the decision lived somewhere a trace cannot see it.
   */
  readonly importanceWeights: ImportanceWeights;
  /**
   * How many ranked solicitations the `uiQuestion` read returns, or null for all
   * of them.
   *
   * Read at use time by the same reader, for the same reason as the weights: a
   * constant here would be the law-1 defect in a new place. The value is a
   * PAYLOAD slice, not the viewport slice — what a person's screen actually
   * showed is measured separately and behaviourally
   * (ui/src/lib/exposure.ts), and the two must not be confused.
   *
   * DEFAULT: 50, documented on its own terms. The shaped read serves machine
   * callers as well as the browser, so the default is set well above any single
   * screenful — an ordinary corpus is returned whole and nothing is amputated
   * from a caller that never asked for a slice — and well below the live
   * solicitation count (~425 on the substrate this vessel fronts), so at the
   * scale where the wall exists the slice is real and `not_shown_count` is
   * non-zero. Truncation is never silent: the read reports how many
   * solicitations exist, how many are in the slice, and how many are not shown.
   */
  readonly visibleSliceSize: number | null;
  /**
   * Who assigned THIS revision — an operator id, an activity name, or null when
   * the author was not stated. Describes this write only and is NEVER inherited
   * from the previous revision: attribution copied onto a revision its named
   * author did not make is false attribution, which is worse than an honest
   * null, because a causal claim ("this activity chose this variant") would then
   * rest on a name the store invented.
   *
   * Read at use time by: the refusal branch of `writeRenderPolicy` below (it
   * tells a second author whose assignment is currently in force before
   * refusing their no-op), the `renderPolicy` resolve
   * (src/routes/impulses.ts:428) and `GET /api/render-policy`
   * (src/routes/proxy.ts:1046-1048), which serve the whole impulse on the
   * browser's poll cadence, and the read-back assertion in
   * validation/human-participation/stage4-trace.ts:71-84, which matches link 2
   * on these VALUES rather than on a status code.
   */
  readonly assignedBy: string | null;
  /**
   * Why this revision was assigned, in the author's own words. Same lifetime,
   * same non-inheritance rule, and the same readers as `assignedBy` above.
   */
  readonly reason: string | null;
  readonly revision: number;
  readonly updatedAt: number;
  readonly note: string | null;
}

/**
 * The keys `writeRenderPolicy` reads out of a patch.
 *
 * Exported because a route that refuses a write must be able to NAME what it
 * accepts instead of just saying no (src/routes/impulses.ts, renderPolicy_write),
 * and a hand-maintained copy of this list in the route would drift from the
 * writer that actually reads it.
 */
export const RENDER_POLICY_PATCH_KEYS = [
  "tokenOverrides",
  "formByShape",
  "maxPreviewChars",
  "ledgerDefaultExpanded",
  "presentation",
  "importanceWeights",
  "visibleSliceSize",
  "note",
  "assignedBy",
  "reason",
] as const;

/**
 * The fields whose movement makes a write a CHANGE.
 *
 * `assignedBy`/`reason` are deliberately excluded. They are metadata ABOUT a
 * change, not a change to how anything renders, so a patch that carries only an
 * author cannot manufacture a revision — and, more importantly, an EMPTY patch
 * (the nested-`policy` pointer) cannot be accepted on the grounds that it
 * "cleared" the previous author.
 */
const RENDER_POLICY_CONTENT_FIELDS = [
  "tokenOverrides",
  "formByShape",
  "maxPreviewChars",
  "ledgerDefaultExpanded",
  "presentation",
  // Both ranking fields are CONTENT: a write that changes only the weights or
  // only the slice size changes what a human is shown, so it must advance the
  // revision. Leaving them out would refuse a weight assignment as "moved no
  // field" — which is precisely how a learner's write would vanish.
  "importanceWeights",
  "visibleSliceSize",
  "note",
] as const satisfies readonly (keyof RenderPolicy)[];

/** What a write did, or why it did nothing. */
export interface RenderPolicyWrite {
  /** True exactly when at least one content field moved and the policy advanced. */
  readonly changed: boolean;
  /** The policy now in force — the new one on a change, the untouched one on a refusal. */
  readonly policy: RenderPolicy;
  /** The content fields that moved. Empty exactly when `changed` is false. */
  readonly changedFields: string[];
  /** Present only on refusal: why nothing was written, and what this writer reads. */
  readonly refusal: { reason: string; acceptedKeys: readonly string[] } | null;
}

let renderPolicy: RenderPolicy = {
  tokenOverrides: {},
  formByShape: {},
  maxPreviewChars: null,
  ledgerDefaultExpanded: true,
  presentation: "onepage",
  importanceWeights: DEFAULT_IMPORTANCE_WEIGHTS,
  visibleSliceSize: DEFAULT_VISIBLE_SLICE_SIZE,
  assignedBy: null,
  reason: null,
  revision: 0,
  updatedAt: Date.now(),
  note: "default — no override; the built-in heuristic is in force",
};

/**
 * A typed instruction and what it actually did.
 *
 * Kept because a render change with no record of who asked for it, in what
 * words, is exactly the untraced mutation the surface is forbidden to make.
 * `unparsed` is stored alongside `changedFields` on purpose: the instructions
 * the parser could NOT read are the demand signal for the next rule, and they
 * are only a signal if they survive the request that produced them.
 */
export interface SurfaceIntentRecord {
  id: string;
  text: string;
  changedFields: string[];
  unparsed: string[];
  /** The revision this instruction produced, or null when it moved nothing. */
  appliedRevision: number | null;
  visibility: Visibility;
  receivedAt: number;
}

const intents: SurfaceIntentRecord[] = [];

export function recordSurfaceIntent(
  i: Omit<SurfaceIntentRecord, "id" | "receivedAt" | "visibility"> & {
    id?: string;
    visibility?: Visibility;
  },
): SurfaceIntentRecord {
  const entry: SurfaceIntentRecord = {
    ...i,
    id: i.id ?? rid("int"),
    visibility: asVisibility(i.visibility, "public"),
    receivedAt: Date.now(),
  };
  intents.push(entry);
  if (intents.length > MAX_HISTORY) intents.shift();
  emit("surface_intent", entry);
  return entry;
}

export function recentSurfaceIntents(limit = 50): SurfaceIntentRecord[] {
  return intents.slice(-limit).reverse();
}

export function getRenderPolicy(): RenderPolicy {
  return renderPolicy;
}

/**
 * Key-order-insensitive canonical form, applied at EVERY depth.
 *
 * Depth matters now that a policy field is itself nested: `importanceWeights`
 * carries `byKind` and `declaredImportance` maps, and a one-level sort would
 * stringify those inner maps in insertion order — so re-writing identical
 * weights with the kinds listed in a different order would read as a CHANGE and
 * manufacture a revision, which is exactly the hollow acceptance
 * `writeRenderPolicy` refuses. Arrays keep their order, because order is content
 * in an array.
 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .sort(([x], [y]) => x.localeCompare(y))
      .map(([k, v]) => [k, canonicalize(v)]);
  }
  return value;
}

/** Value equality for a policy field — key-order-insensitive at every depth. */
function sameFieldValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a && b && typeof a === "object" && typeof b === "object") {
    return JSON.stringify(canonicalize(a)) === JSON.stringify(canonicalize(b));
  }
  return false;
}

/**
 * Write the behaviour impulse — or REFUSE.
 *
 * Two properties this function is responsible for, both of which it previously
 * lacked:
 *
 * 1. `revision` is CONTENT IDENTITY. It advances if and only if a content field
 *    actually moved, so "impulse plus exact revision" can be reconstructed from
 *    it. It used to advance on every call whatever it was handed, which is how a
 *    write that recorded nothing at all read as a success (the stage-4 trace's
 *    link 2: status 200, revision 0 → 1, zero fields recorded).
 *
 * 2. A write that moves nothing is REFUSED and says what this writer reads,
 *    rather than being accepted hollowly. This is the surfaceIntent
 *    unparsed-clause precedent in this same vessel (src/routes/impulses.ts:485-510
 *    — nothing moved, so nothing is written, the revision does not advance, and
 *    the caller is told what the parser does read) applied to the impulse write
 *    path. A refusal that also names the assignment currently in force lets the
 *    caller see whose decision their no-op was about to overwrite.
 *
 * Accepted writes are journaled as a SNAPSHOT and replayed at module init, so a
 * restart does not silently revert the policy to the compiled default.
 */
export function writeRenderPolicy(patch: {
  tokenOverrides?: Record<string, string>;
  formByShape?: Record<string, string>;
  maxPreviewChars?: number | null;
  ledgerDefaultExpanded?: boolean;
  presentation?: "onepage" | "stacked";
  /**
   * A FULL or PARTIAL replacement of the ranking weights.
   *
   * Partial means field-by-field: a top-level field the patch omits keeps the
   * value in force. A map the patch DOES supply (`byKind`,
   * `declaredImportance`) replaces that map wholly rather than merging keys,
   * because a key-merge can never remove a weight — an author who means "these
   * are the weights" would silently keep stale entries they thought they had
   * dropped, and the impulse would then describe an order nobody chose. To clear
   * a map, send `{}`; every unlisted key is then scored at that map's documented
   * neutral (importance.ts `neutralOf`), not at zero.
   */
  importanceWeights?: Partial<ImportanceWeights>;
  visibleSliceSize?: number | null;
  note?: string | null;
  assignedBy?: string | null;
  reason?: string | null;
}): RenderPolicyWrite {
  const weightPatch = patch.importanceWeights;
  const candidate: RenderPolicy = {
    tokenOverrides: patch.tokenOverrides ?? renderPolicy.tokenOverrides,
    formByShape: patch.formByShape ?? renderPolicy.formByShape,
    maxPreviewChars:
      patch.maxPreviewChars === undefined ? renderPolicy.maxPreviewChars : patch.maxPreviewChars,
    ledgerDefaultExpanded: patch.ledgerDefaultExpanded ?? renderPolicy.ledgerDefaultExpanded,
    presentation: patch.presentation ?? renderPolicy.presentation,
    importanceWeights: weightPatch
      ? {
          byKind: weightPatch.byKind ?? renderPolicy.importanceWeights.byKind,
          agePerDay: weightPatch.agePerDay ?? renderPolicy.importanceWeights.agePerDay,
          declaredImportance:
            weightPatch.declaredImportance ?? renderPolicy.importanceWeights.declaredImportance,
          unansweredBoost:
            weightPatch.unansweredBoost ?? renderPolicy.importanceWeights.unansweredBoost,
        }
      : renderPolicy.importanceWeights,
    // `=== undefined`, not `??`: null is a MEANING here ("no slice — return every
    // ranked solicitation"), and `??` would silently turn it into the default.
    visibleSliceSize:
      patch.visibleSliceSize === undefined ? renderPolicy.visibleSliceSize : patch.visibleSliceSize,
    // NOT `?? renderPolicy.assignedBy` — see the field comment: this write's
    // author, or null. Never the previous author's name on someone else's edit.
    assignedBy: patch.assignedBy ?? null,
    reason: patch.reason ?? null,
    revision: renderPolicy.revision + 1,
    updatedAt: Date.now(),
    note: patch.note === undefined ? renderPolicy.note : patch.note,
  };

  const changedFields = RENDER_POLICY_CONTENT_FIELDS.filter(
    (f) => !sameFieldValue(renderPolicy[f], candidate[f]),
  );

  if (changedFields.length === 0) {
    const inForce = renderPolicy.assignedBy
      ? `revision ${renderPolicy.revision} was assigned by ${renderPolicy.assignedBy}${
          renderPolicy.reason ? ` because: ${renderPolicy.reason}` : ""
        }`
      : `revision ${renderPolicy.revision} names no assigner${
          renderPolicy.reason ? ` and gives the reason: ${renderPolicy.reason}` : ""
        }`;
    return {
      changed: false,
      policy: renderPolicy,
      changedFields: [],
      refusal: {
        reason:
          `this write moved no field, so nothing was recorded and the revision did not advance. ` +
          `The keys this writer reads are: ${RENDER_POLICY_PATCH_KEYS.join(", ")} ` +
          `(assignedBy/reason describe a change and cannot make one on their own). ` +
          `The policy in force is unchanged: ${inForce}.`,
        acceptedKeys: RENDER_POLICY_PATCH_KEYS,
      },
    };
  }

  renderPolicy = candidate;
  appendParticipation("renderPolicy_write", renderPolicy);
  emit("renderPolicy", renderPolicy);
  return { changed: true, policy: renderPolicy, changedFields: [...changedFields], refusal: null };
}

/**
 * Replay of the policy snapshot — deliberately NOT beside the panel/feedback
 * replays at the top of this file: `renderPolicy` is declared above with `let`,
 * so a loop placed up there would touch it in its temporal dead zone and throw
 * at import. Like those loops it preserves the journaled identity (`revision`,
 * `updatedAt`, `assignedBy`, `reason`) and emits nothing — a restart is not a
 * new assignment. The last valid line wins: each line is a whole snapshot.
 */
for (const raw of readParticipation("renderPolicy_write")) {
  const p = raw as Partial<RenderPolicy> | null;
  if (!p || typeof p !== "object") continue;
  if (!Number.isInteger(p.revision) || (p.revision as number) < 1) continue;
  if (typeof p.updatedAt !== "number" || !Number.isFinite(p.updatedAt)) continue;
  if (p.presentation !== "onepage" && p.presentation !== "stacked") continue;
  /**
   * A journal line written before the ranking fields existed carries neither of
   * them, and a line written by a future author could carry junk. Both restore
   * to the documented default rather than to a broken policy: the replay's job
   * is to not lose an assignment, never to invent one. Only finite numbers
   * survive into a weight map — a NaN weight would not crash the scorer (it
   * treats non-finite as 0) but it would make the impulse claim a weight that
   * scores as something else, and the impulse is what a grader reads.
   */
  const numberMap = (v: unknown): Record<string, number> | undefined =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v as Record<string, unknown>).filter(
            (e): e is [string, number] => typeof e[1] === "number" && Number.isFinite(e[1]),
          ),
        )
      : undefined;
  const finite = (v: unknown): number | undefined =>
    typeof v === "number" && Number.isFinite(v) ? v : undefined;
  const journaledWeights = (v: unknown): ImportanceWeights => {
    const w = (v && typeof v === "object" ? v : {}) as Partial<ImportanceWeights>;
    return {
      byKind: numberMap(w.byKind) ?? DEFAULT_IMPORTANCE_WEIGHTS.byKind,
      agePerDay: finite(w.agePerDay) ?? DEFAULT_IMPORTANCE_WEIGHTS.agePerDay,
      declaredImportance:
        numberMap(w.declaredImportance) ?? DEFAULT_IMPORTANCE_WEIGHTS.declaredImportance,
      unansweredBoost: finite(w.unansweredBoost) ?? DEFAULT_IMPORTANCE_WEIGHTS.unansweredBoost,
    };
  };
  const stringMap = (v: unknown): Record<string, string> =>
    v && typeof v === "object"
      ? Object.fromEntries(
          Object.entries(v as Record<string, unknown>).filter(
            (e): e is [string, string] => typeof e[1] === "string",
          ),
        )
      : {};
  renderPolicy = {
    tokenOverrides: stringMap(p.tokenOverrides),
    formByShape: stringMap(p.formByShape),
    maxPreviewChars: typeof p.maxPreviewChars === "number" ? p.maxPreviewChars : null,
    ledgerDefaultExpanded: typeof p.ledgerDefaultExpanded === "boolean" ? p.ledgerDefaultExpanded : true,
    presentation: p.presentation,
    importanceWeights: journaledWeights(p.importanceWeights),
    // `null` is a journaled MEANING (no slice), so it is preserved; only a
    // missing or non-numeric value falls back to the documented default.
    visibleSliceSize:
      p.visibleSliceSize === null ? null : (finite(p.visibleSliceSize) ?? DEFAULT_VISIBLE_SLICE_SIZE),
    assignedBy: typeof p.assignedBy === "string" ? p.assignedBy : null,
    reason: typeof p.reason === "string" ? p.reason : null,
    revision: p.revision as number,
    updatedAt: p.updatedAt,
    note: typeof p.note === "string" ? p.note : null,
  };
}
