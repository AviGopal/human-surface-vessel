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
 * No persistence — a restart clears every store.
 */

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
  body: string;
  kind: string;
  importance: string;
  asks?: Ask[];
  visibility: Visibility;
  createdAt: number;
  updatedAt: number;
}

export interface Feedback {
  panelId: string;
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
  p: Omit<Panel, "createdAt" | "updatedAt" | "visibility"> & {
    createdAt?: number;
    visibility?: Visibility;
  },
): Panel {
  const now = Date.now();
  const existing = panels.get(p.id);
  const stored: Panel = {
    ...p,
    visibility: asVisibility(p.visibility, "public"),
    createdAt: existing?.createdAt ?? p.createdAt ?? now,
    updatedAt: now,
  };
  panels.set(p.id, stored);
  emit(existing ? "panel_updated" : "panel_added", stored);
  return stored;
}

export function listPanels(): Panel[] {
  return Array.from(panels.values()).sort((a, b) => b.updatedAt - a.updatedAt);
}

export function recordFeedback(
  f: Omit<Feedback, "receivedAt" | "visibility"> & { visibility?: Visibility },
): Feedback {
  const entry: Feedback = {
    ...f,
    visibility: asVisibility(f.visibility, "public"),
    receivedAt: Date.now(),
  };
  feedback.push(entry);
  if (feedback.length > MAX_HISTORY) feedback.shift();
  emit("feedback_received", entry);
  return entry;
}

export function recentFeedback(limit = 50): Feedback[] {
  return feedback.slice(-limit).reverse();
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

  const answeredPanels = new Set<string>();
  const dismissedPanels = new Set<string>();
  for (const f of feedback) {
    if (f.kind === "answer") answeredPanels.add(f.panelId);
    if (f.kind === "dismiss") dismissedPanels.add(f.panelId);
  }

  const ages: number[] = [];
  let panelsOpen = 0;
  for (const p of panels.values()) {
    const isOpen = !dismissedPanels.has(p.id) && !answeredPanels.has(p.id);
    if (isOpen) panelsOpen += 1;
    if ((p.asks?.length ?? 0) > 0 && !answeredPanels.has(p.id)) {
      ages.push(now - p.createdAt);
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
  readonly revision: number;
  readonly updatedAt: number;
  readonly note: string | null;
}

let renderPolicy: RenderPolicy = {
  tokenOverrides: {},
  formByShape: {},
  maxPreviewChars: null,
  ledgerDefaultExpanded: true,
  revision: 0,
  updatedAt: Date.now(),
  note: "default — no override; the built-in heuristic is in force",
};

export function getRenderPolicy(): RenderPolicy {
  return renderPolicy;
}

export function writeRenderPolicy(patch: {
  tokenOverrides?: Record<string, string>;
  formByShape?: Record<string, string>;
  maxPreviewChars?: number | null;
  ledgerDefaultExpanded?: boolean;
  note?: string | null;
}): RenderPolicy {
  renderPolicy = {
    tokenOverrides: patch.tokenOverrides ?? renderPolicy.tokenOverrides,
    formByShape: patch.formByShape ?? renderPolicy.formByShape,
    maxPreviewChars:
      patch.maxPreviewChars === undefined ? renderPolicy.maxPreviewChars : patch.maxPreviewChars,
    ledgerDefaultExpanded: patch.ledgerDefaultExpanded ?? renderPolicy.ledgerDefaultExpanded,
    revision: renderPolicy.revision + 1,
    updatedAt: Date.now(),
    note: patch.note === undefined ? renderPolicy.note : patch.note,
  };
  emit("renderPolicy", renderPolicy);
  return renderPolicy;
}
