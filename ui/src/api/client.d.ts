/**
 * Every call in this file is same-origin and relative. There is no configurable
 * base URL and no environment variable naming a host, on purpose:
 *
 *  - goal-host has NO CORS and NO inbound auth. A browser cannot call it, and
 *    if it could, the API key would have to be in the bundle. This vessel's own
 *    server is the security boundary; it holds the key and this code never sees
 *    one.
 *  - An absolute URL here would also be a rule P12 violation the moment it is
 *    bundled.
 */
import type { ActiveDispatch, DispatchOutcome, DispatchRequest, GoalWalkState, GradeSubmission, SolicitationOutcome } from "./types";
export declare class SurfaceError extends Error {
    readonly httpStatus: number;
    constructor(message: string, httpStatus: number);
}
export declare function dispatchGoal(req: DispatchRequest): Promise<DispatchOutcome>;
export declare function fetchWalkState(dispatchId: string): Promise<GoalWalkState>;
export declare function fetchActiveDispatches(): Promise<readonly ActiveDispatch[]>;
/** Answer a mid-walk question in place. */
export declare function answerSolicitation(args: {
    solicitationId: string;
    outcome: SolicitationOutcome;
    answer: string;
}): Promise<unknown>;
/**
 * The salvage path: push context into a walk that is already running rather
 * than killing it and re-typing the goal. 409 when the dispatch is no longer
 * running — that is a real answer, not a bug, and is surfaced as one.
 */
export declare function injectContext(args: {
    dispatchId: string;
    shape: string;
    content: string;
    summary?: string;
}): Promise<unknown>;
/**
 * The fleet's shape vocabulary. Starters are derived from THIS, at render time.
 * There is no hardcoded starter list anywhere in this surface: a fixed list
 * goes stale silently and starts advertising capabilities the fleet no longer
 * has.
 *
 * ASSUMED PROXY ROUTE: `GET /api/discovery/shapes`, forwarding to discovery's
 * keyless `GET /registry/shapes` → `{ shapes: string[] }`.
 */
export declare function fetchFleetShapes(): Promise<readonly string[]>;
/**
 * Does anything actually serve this shape? Used to REFINE starters after they
 * have already rendered — never to gate the first paint. A surface that waits
 * on N capability lookups before showing a single suggestion has reproduced the
 * blank box it exists to remove.
 */
export declare function fetchCapability(shape: string): Promise<boolean>;
/**
 * A human verdict into the oracle corpus.
 *
 * CONTRACT NOTE — this is the one route in this file that is not in the
 * verified proxy set. A human grade is NOT a goal-host shape: goal-host's
 * served-shape list does not include `goal_verification_label_write`, and
 * posting it to `/api/resolve` would be rejected. The real channel is
 * activity-api's impulse resolve, which goal-host itself writes to when it
 * records a machine verdict.
 *
 * The server side must therefore expose `POST /api/grade` forwarding to
 * activity-api with:
 *
 *   { pointer: { type: "goal_verification_label_write",
 *                goal, execution_id, activity_id: "unattributed",
 *                verdict, confidence: 1, labeler: "human", notes } }
 *
 * `labeler: "human"` is load-bearing — goal-host only lets a HUMAN verdict
 * override `reached`, and only a human label burns the consumption latch.
 *
 * If the route is absent this throws and the UI says so. It does not render a
 * green tick over a verdict that went nowhere.
 */
export declare function submitGrade(g: GradeSubmission): Promise<void>;
export interface RenderPolicy {
    readonly tokenOverrides: Readonly<Record<string, string>>;
    readonly formByShape: Readonly<Record<string, string>>;
    readonly maxPreviewChars: number | null;
    readonly ledgerDefaultExpanded: boolean;
    readonly revision: number;
    readonly updatedAt: number;
    readonly note: string | null;
}
/**
 * The behaviour impulse the surface renders by. Fetched on the live cadence,
 * not at startup — a policy read once at boot would be a constant again.
 */
export declare function fetchRenderPolicy(): Promise<RenderPolicy>;
//# sourceMappingURL=client.d.ts.map