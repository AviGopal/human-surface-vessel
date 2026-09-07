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
const panels = new Map();
const feedback = [];
const observations = [];
const events = [];
const asserts = [];
const attachments = [];
const MAX_HISTORY = 500;
const listeners = new Set();
export function subscribe(fn) {
    listeners.add(fn);
    return () => {
        listeners.delete(fn);
    };
}
function emit(event, data) {
    for (const l of listeners) {
        try {
            l({ event, data });
        }
        catch {
            /* a broken listener must never break a write */
        }
    }
}
export function rid(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
export function asVisibility(v, fallback) {
    return v === "public" || v === "operator_only" ? v : fallback;
}
export function upsertPanel(p) {
    const now = Date.now();
    const existing = panels.get(p.id);
    const stored = {
        ...p,
        visibility: asVisibility(p.visibility, "public"),
        createdAt: existing?.createdAt ?? p.createdAt ?? now,
        updatedAt: now,
    };
    panels.set(p.id, stored);
    emit(existing ? "panel_updated" : "panel_added", stored);
    return stored;
}
export function listPanels() {
    return Array.from(panels.values()).sort((a, b) => b.updatedAt - a.updatedAt);
}
export function recordFeedback(f) {
    const entry = {
        ...f,
        visibility: asVisibility(f.visibility, "public"),
        receivedAt: Date.now(),
    };
    feedback.push(entry);
    if (feedback.length > MAX_HISTORY)
        feedback.shift();
    emit("feedback_received", entry);
    return entry;
}
export function recentFeedback(limit = 50) {
    return feedback.slice(-limit).reverse();
}
export function recordObservation(o) {
    const entry = {
        ...o,
        visibility: asVisibility(o.visibility, "operator_only"),
        observedAt: Date.now(),
    };
    observations.push(entry);
    if (observations.length > MAX_HISTORY)
        observations.shift();
    emit("observation_recorded", entry);
    return entry;
}
export function recentObservations(limit = 50) {
    return observations.slice(-limit).reverse();
}
export function recordEvent(e) {
    const entry = {
        ...e,
        id: e.id ?? rid("evt"),
        visibility: asVisibility(e.visibility, "public"),
        occurredAt: Date.now(),
    };
    events.push(entry);
    if (events.length > MAX_HISTORY)
        events.shift();
    emit("event_recorded", entry);
    return entry;
}
export function recentEvents(limit = 50) {
    return events.slice(-limit).reverse();
}
export function recordAssertion(a) {
    const entry = {
        ...a,
        id: a.id ?? rid("asn"),
        visibility: asVisibility(a.visibility, "operator_only"),
        assertedAt: Date.now(),
    };
    asserts.push(entry);
    if (asserts.length > MAX_HISTORY)
        asserts.shift();
    emit("assertion_recorded", entry);
    return entry;
}
export function recentAsserts(limit = 50) {
    return asserts.slice(-limit).reverse();
}
export function recordAttachment(a) {
    const entry = {
        ...a,
        id: a.id ?? rid("att"),
        visibility: asVisibility(a.visibility, "operator_only"),
        attachedAt: Date.now(),
    };
    attachments.push(entry);
    if (attachments.length > MAX_HISTORY)
        attachments.shift();
    emit("attachment_recorded", entry);
    return entry;
}
export function recentAttachments(limit = 50) {
    return attachments.slice(-limit).reverse();
}
export function counts() {
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
export function signatureInputs() {
    const now = Date.now();
    const recentWindow = now - 300_000;
    const recentEventsCount = events.reduce((n, e) => (e.occurredAt >= recentWindow ? n + 1 : n), 0);
    const answeredPanels = new Set();
    const dismissedPanels = new Set();
    for (const f of feedback) {
        if (f.kind === "answer")
            answeredPanels.add(f.panelId);
        if (f.kind === "dismiss")
            dismissedPanels.add(f.panelId);
    }
    const ages = [];
    let panelsOpen = 0;
    for (const p of panels.values()) {
        const isOpen = !dismissedPanels.has(p.id) && !answeredPanels.has(p.id);
        if (isOpen)
            panelsOpen += 1;
        if ((p.asks?.length ?? 0) > 0 && !answeredPanels.has(p.id)) {
            ages.push(now - p.createdAt);
        }
    }
    ages.sort((a, b) => a - b);
    const p95 = ages.length === 0
        ? 0
        : (ages[Math.min(ages.length - 1, Math.floor(ages.length * 0.95))] ?? 0);
    const pendingAsserts = asserts.reduce((n, a) => a.visibility === "operator_only" && a.assertedAt >= recentWindow ? n + 1 : n, 0);
    return {
        recent_interactor_events_count: recentEventsCount,
        unanswered_asks_age_ms_p95: p95,
        operator_assertion_pending_count: pendingAsserts,
        panels_open_count: panelsOpen,
    };
}
let renderPolicy = {
    tokenOverrides: {},
    formByShape: {},
    maxPreviewChars: null,
    ledgerDefaultExpanded: true,
    revision: 0,
    updatedAt: Date.now(),
    note: "default — no override; the built-in heuristic is in force",
};
const intents = [];
export function recordSurfaceIntent(i) {
    const entry = {
        ...i,
        id: i.id ?? rid("int"),
        visibility: asVisibility(i.visibility, "public"),
        receivedAt: Date.now(),
    };
    intents.push(entry);
    if (intents.length > MAX_HISTORY)
        intents.shift();
    emit("surface_intent", entry);
    return entry;
}
export function recentSurfaceIntents(limit = 50) {
    return intents.slice(-limit).reverse();
}
export function getRenderPolicy() {
    return renderPolicy;
}
export function writeRenderPolicy(patch) {
    renderPolicy = {
        tokenOverrides: patch.tokenOverrides ?? renderPolicy.tokenOverrides,
        formByShape: patch.formByShape ?? renderPolicy.formByShape,
        maxPreviewChars: patch.maxPreviewChars === undefined ? renderPolicy.maxPreviewChars : patch.maxPreviewChars,
        ledgerDefaultExpanded: patch.ledgerDefaultExpanded ?? renderPolicy.ledgerDefaultExpanded,
        revision: renderPolicy.revision + 1,
        updatedAt: Date.now(),
        note: patch.note === undefined ? renderPolicy.note : patch.note,
    };
    emit("renderPolicy", renderPolicy);
    return renderPolicy;
}
//# sourceMappingURL=store.js.map