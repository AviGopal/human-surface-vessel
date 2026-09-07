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
declare function corsHeaders(requestOrigin: string | undefined): Record<string, string>;
declare function resolveGoalHostEndpoint(): Promise<string>;
export declare const proxyRouter: any;
export { corsHeaders, resolveGoalHostEndpoint };
export default proxyRouter;
//# sourceMappingURL=proxy.d.ts.map