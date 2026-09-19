/**
 * The browser proxy — a SECURITY BOUNDARY, not a CORS shim.
 *
 * goal-host-vessel has NO inbound auth of any kind: no middleware, no header
 * check, no 401 path. Any request that reaches port 8210 executes a goal. It
 * also sets no CORS headers at all and 404s preflight. Two consequences drive
 * every decision in this file:
 *
 *   1. The browser must NEVER reach goal-host. Only this vessel talks to it.
 *   2. The API key must NEVER reach the browser. It is injected server-side
 *      here and never echoed into a response body.
 *
 * Other load-bearing properties:
 *
 *   - Upstream status and body are returned UNCHANGED. `202`, `200` with
 *     `refused:true`, and `503` with `draining:true` are each distinct signals
 *     to the client's poll loop; re-wrapping them destroys information. The
 *     upstream body is streamed through, never parsed and rebuilt.
 *   - Outbound headers are CONSTRUCTED, never forwarded. That strips any
 *     inbound `x-caller-vessel` (which, absent `parent_execution_id`, trips
 *     goal-host's D3 guard and 400s the call) and everything else a hostile
 *     page might try to smuggle.
 *   - goal-host is located THROUGH DISCOVERY by shape, cached briefly, with
 *     the env and the loopback literal as fallbacks only. A peer address is
 *     never the sole path to a peer.
 */
import { Hono } from "hono";
declare function corsHeaders(requestOrigin: string | undefined): Record<string, string>;
/**
 * Does this address actually serve goal shapes?
 *
 * The probe is a REAL resolve call and deliberately not `/health`. Measured on
 * a live spoke: the federation transport answers `/health` with 200 and answers
 * `/resolve` with 404, so a health check selects a candidate that then fails
 * every call the surface makes. A liveness probe that is not the thing you are
 * about to do is not evidence you can do it.
 *
 * `activeDispatches` is the cheapest shape goal-host serves and the one the
 * board already polls, so a passing probe means the exact call path works.
 */
/**
 * One address the surface could talk to, with the paths that address serves.
 *
 * The path is carried WITH the address because it is not the same for every
 * producer, and assuming it was is what broke this surface. See the note on
 * `servesGoalShapes`.
 */
interface GoalHostCandidate {
    readonly base: string;
    /** This row's advertised resolve path — `/resolve` for an ordinary vessel. */
    readonly resolvePath: string;
}
declare function resolveGoalHostEndpoint(): Promise<GoalHostCandidate>;
export declare const proxyRouter: Hono<import("hono/types").BlankEnv, import("hono/types").BlankSchema, "/">;
export { corsHeaders, resolveGoalHostEndpoint };
export default proxyRouter;
//# sourceMappingURL=proxy.d.ts.map