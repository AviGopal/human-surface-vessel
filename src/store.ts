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

export interface Observation {
  type: "click" | "dwell" | "scroll" | "focus";
  panelId?: string;
  askId?: string;
  durationMs?: number;
  position?: { x: number; y: number };
  visibility: Visibility;
  observedAt: number;
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

export class ParticipationConflict extends Error {}

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
  if (f.panelRevision !== undefined) {
    const panel = panels.get(f.panelId);
    if (!panel || panel.kind !== "question" || panel.revision !== f.panelRevision) {
      throw new ParticipationConflict("The question changed or is unavailable. Review it before responding; your draft has not been applied.");
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

export function recordObservation(
  o: Omit<Observation, "observedAt" | "visibility"> & { visibility?: Visibility },
): Observation {
  const entry: Observation = {
    ...o,
    visibility: asVisibility(o.visibility, "operator_only"),
    observedAt: Date.now(),
  };
  observations.push(entry);
  if (observations.length > MAX_HISTORY) observations.shift();
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
    if (isOpen && (p.kind === "question" || (p.asks?.length ?? 0) > 0)) {
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
  readonly revision: number;
  readonly updatedAt: number;
  readonly note: string | null;
}

let renderPolicy: RenderPolicy = {
  tokenOverrides: {},
  formByShape: {},
  maxPreviewChars: null,
  ledgerDefaultExpanded: true,
  presentation: "onepage",
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

export function writeRenderPolicy(patch: {
  tokenOverrides?: Record<string, string>;
  formByShape?: Record<string, string>;
  maxPreviewChars?: number | null;
  ledgerDefaultExpanded?: boolean;
  presentation?: "onepage" | "stacked";
  note?: string | null;
}): RenderPolicy {
  renderPolicy = {
    tokenOverrides: patch.tokenOverrides ?? renderPolicy.tokenOverrides,
    formByShape: patch.formByShape ?? renderPolicy.formByShape,
    maxPreviewChars:
      patch.maxPreviewChars === undefined ? renderPolicy.maxPreviewChars : patch.maxPreviewChars,
    ledgerDefaultExpanded: patch.ledgerDefaultExpanded ?? renderPolicy.ledgerDefaultExpanded,
    presentation: patch.presentation ?? renderPolicy.presentation,
    revision: renderPolicy.revision + 1,
    updatedAt: Date.now(),
    note: patch.note === undefined ? renderPolicy.note : patch.note,
  };
  emit("renderPolicy", renderPolicy);
  return renderPolicy;
}
