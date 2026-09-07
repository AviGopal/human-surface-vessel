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
    position?: {
        x: number;
        y: number;
    };
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
type Listener = (event: {
    event: string;
    data: unknown;
}) => void;
export declare function subscribe(fn: Listener): () => void;
export declare function rid(prefix: string): string;
export declare function asVisibility(v: unknown, fallback: Visibility): Visibility;
export declare function upsertPanel(p: Omit<Panel, "createdAt" | "updatedAt" | "visibility"> & {
    createdAt?: number;
    visibility?: Visibility;
}): Panel;
export declare function listPanels(): Panel[];
export declare function recordFeedback(f: Omit<Feedback, "receivedAt" | "visibility"> & {
    visibility?: Visibility;
}): Feedback;
export declare function recentFeedback(limit?: number): Feedback[];
export declare function recordObservation(o: Omit<Observation, "observedAt" | "visibility"> & {
    visibility?: Visibility;
}): Observation;
export declare function recentObservations(limit?: number): Observation[];
export declare function recordEvent(e: Omit<InteractorEvent, "id" | "occurredAt" | "visibility"> & {
    id?: string;
    visibility?: Visibility;
}): InteractorEvent;
export declare function recentEvents(limit?: number): InteractorEvent[];
export declare function recordAssertion(a: Omit<InteractorAssertion, "id" | "assertedAt" | "visibility"> & {
    id?: string;
    visibility?: Visibility;
}): InteractorAssertion;
export declare function recentAsserts(limit?: number): InteractorAssertion[];
export declare function recordAttachment(a: Omit<InteractorAttachment, "id" | "attachedAt" | "visibility"> & {
    id?: string;
    visibility?: Visibility;
}): InteractorAttachment;
export declare function recentAttachments(limit?: number): InteractorAttachment[];
export declare function counts(): Record<string, number>;
/** Inputs for the substrate's state-signature integration. */
export interface SignatureInputs {
    recent_interactor_events_count: number;
    unanswered_asks_age_ms_p95: number;
    operator_assertion_pending_count: number;
    panels_open_count: number;
}
export declare function signatureInputs(): SignatureInputs;
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
export declare function recordSurfaceIntent(i: Omit<SurfaceIntentRecord, "id" | "receivedAt" | "visibility"> & {
    id?: string;
    visibility?: Visibility;
}): SurfaceIntentRecord;
export declare function recentSurfaceIntents(limit?: number): SurfaceIntentRecord[];
export declare function getRenderPolicy(): RenderPolicy;
export declare function writeRenderPolicy(patch: {
    tokenOverrides?: Record<string, string>;
    formByShape?: Record<string, string>;
    maxPreviewChars?: number | null;
    ledgerDefaultExpanded?: boolean;
    note?: string | null;
}): RenderPolicy;
export {};
//# sourceMappingURL=store.d.ts.map