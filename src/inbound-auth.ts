/**
 * WHO IS WRITING: the one inbound credential seam for every human-surface write route.
 *
 * Before this, no route here validated a caller. The only write guard refused a foreign
 * Origin header (routes/proxy.ts refuseForeignOriginWrites, still the FIRST gate in
 * index.ts), so curl, any vessel and any in-process test wrote panels and started walks,
 * and /api/run-goal forwarded them to goal-host under this vessel's fleet key.
 *
 * POLICY, by caller:
 *   1. `Authorization: ApiKey <key>` is validated by identity-vessel, the fleet's single
 *      validator, through caller-credential.ts (development-vessel's module, carried as a
 *      pinned copy). A refused key is 401. A valid one is a caller with a label and an
 *      origin class: "operator" for an operator:direct or admin scope (development-vessel
 *      src/lib/operator-direct.ts:45, isOperatorDirectCredential), "automated" otherwise,
 *      this vessel's own key included.
 *   2. A keyless request whose Origin is this vessel's own page is the browser. It is
 *      accepted ONLY where BROWSER_WRITE_ALLOWLIST names the route (and, on /api/resolve,
 *      the shape), or BROWSER_READ_ALLOWLIST names a read the page sends on such a route,
 *      as origin "browser-unverified". That is NOT authentication: Origin is a
 *      header, and a non-browser caller can send any value. It stays named as a residual
 *      until sign-in gives the browser a credential.
 *   3. Keyless with no Origin (curl, a vessel without a key, an in-process test) or with a
 *      foreign one is refused on every write route.
 *
 * FAIL CLOSED. Identity unreachable, unset, or erroring is a refusal for every key except
 * this vessel's own, which caller-credential.ts authenticates locally so the node's own
 * writes survive an identity outage.
 *
 * EVERY REFUSAL NAMES ITS CAUSE, in the body and in the log line, never a bare 401. The
 * body is development-vessel's refusal (src/routes/impulses.ts refuseUnauthenticatedWrite:
 * `{success:false, error:"caller_credential_required: <what> is a write; <why>"}`) with a
 * `reason` beside it: identity_unreachable | key_rejected | keyless_not_allowlisted. The log
 * line carries the reason and an unverified caller hint, so refusals can be counted by
 * cause and by caller; /health reports the same counts.
 *
 * IN-PROCESS CALLS carry the caller they were admitted as. A browser route that writes
 * through the impulse route (participation, feedback, observations) passes its caller in
 * the request's env, which only code in this process can set, instead of re-posting over
 * HTTP under the fleet key (which made every browser write the fleet's own).
 */
import type { Context, MiddlewareHandler } from "hono";
import { identityCredential, isNodeSelfCredential, type CallerCredential } from "./caller-credential.ts";
import { IDENTITY_VESSEL_URL } from "./config.ts";
import { isOwnOrigin } from "./routes/proxy.ts";

export type CallerOrigin = "operator" | "automated" | "browser-unverified";
export type RefusalReason = "identity_unreachable" | "key_rejected" | "keyless_not_allowlisted";

/** Who a write route admitted. `label` is what a downstream record may name; never the key or its digest. */
export interface Caller {
  readonly kind: "key" | "browser";
  readonly origin: CallerOrigin;
  readonly label: string;
}

/**
 * THE KEYLESS BROWSER ALLOWLIST: the write routes this vessel's own page calls, and nothing
 * else. One list so it can be trimmed without touching the logic. Each entry cites the
 * ui/src call site; a route the UI does not call does not belong here.
 */
export const BROWSER_WRITE_ALLOWLIST: ReadonlyArray<{ readonly route: string; readonly shapes?: readonly string[] }> = [
  // ui/src/api/participation.ts:109 (an answer or a decline)
  { route: "/api/participation" },
  // ui/src/api/client.ts:334 (a verdict on a run)
  { route: "/api/grade" },
  // ui/src/api/calibration.ts:47 (a calibration window's grade)
  { route: "/api/calibration/grade" },
  // ui/src/components/TopBar.tsx:162 (a complaint typed in the box)
  { route: "/api/feedback" },
  // ui/src/api/exposure.ts:68, :78 (exposure ticks and outcomes)
  { route: "/api/observations" },
  // ui/src/api/client.ts:107 (an instruction to change the interface)
  { route: "/api/surface-intent" },
  // ui/src/api/client.ts:154 (ask a goal)
  { route: "/api/run-goal" },
  // ui/src/api/session.ts (a person signing in and out; the credential goes to identity, never to a store)
  { route: "/api/session/login" },
  { route: "/api/session/logout" },
  // ui/src/api/client.ts:188 resolveShape, these WRITES only. They forward to goal-host and
  // answer, extend or inject into a RUNNING walk, any walk, autonomous ones included:
  // solicitationResponse_write (:243), solicitationHeartbeat_write (:252), poolImpulse_write
  // (:266; ui/src/lib/interaction.ts:69). qa may cut them. The reads the page sends on the
  // same route are BROWSER_READ_ALLOWLIST's.
  {
    route: "/api/resolve",
    shapes: ["solicitationResponse_write", "solicitationHeartbeat_write", "poolImpulse_write"],
  },
  // ui/src/api/client.ts:294 (fetchCapability: a capability read sent as a POST)
  { route: "/api/discovery/resolve" },
  // ui/src/components/ContentRender.tsx:517 (a page drawn in its own frame). Its frame-session cookie is
  // handed to whoever loads "/", so it scopes which frames a session may read back, and names no caller.
  { route: "/api/page-frame" },
];

/**
 * THE KEYLESS BROWSER READS on a route that also carries writes: what the page reads
 * through /api/resolve, kept apart from the writes so neither list can grow the other.
 * A read here writes nothing; it is admitted because the route is gated as a whole.
 */
export const BROWSER_READ_ALLOWLIST: ReadonlyArray<{ readonly route: string; readonly shapes: readonly string[] }> = [
  // ui/src/api/client.ts:202 fetchWalkState (goalWalkState), :207 fetchActiveDispatches (activeDispatches)
  { route: "/api/resolve", shapes: ["goalWalkState", "activeDispatches"] },
];

function browserAllowed(route: string, shape: string | undefined): boolean {
  const write = BROWSER_WRITE_ALLOWLIST.find((e) => e.route === route);
  if (write && (!write.shapes || (shape !== undefined && write.shapes.includes(shape)))) return true;
  const read = BROWSER_READ_ALLOWLIST.find((e) => e.route === route);
  return read !== undefined && shape !== undefined && read.shapes.includes(shape);
}

const OPERATOR_SCOPES = ["operator:direct", "admin"];

/** The label a downstream record may carry for a validated key: never the key or its digest. */
function keyLabel(cred: CallerCredential): string {
  if (isNodeSelfCredential(cred)) return "node-self";
  if (cred.keyId) return `key:${cred.keyId}`;
  return `key:scopes=${cred.scopes.length > 0 ? cred.scopes.join("+") : "none"}`;
}

const issued = new WeakSet<Caller>();
function admit(caller: Caller): Caller {
  const frozen = Object.freeze(caller);
  issued.add(frozen);
  return frozen;
}
const BROWSER: Caller = admit({ kind: "browser", origin: "browser-unverified", label: "browser-unverified" });

function keyCaller(cred: CallerCredential): Caller {
  const operator = !isNodeSelfCredential(cred) && cred.scopes.some((s) => OPERATOR_SCOPES.includes(s));
  return admit({ kind: "key", origin: operator ? "operator" : "automated", label: keyLabel(cred) });
}

/** The env an in-process call passes so the route it calls sees the caller already admitted. */
export function carry(caller: Caller): { inboundCaller: Caller } {
  return { inboundCaller: caller };
}

function carried(c: Context): Caller | null {
  const env = c.env as { inboundCaller?: unknown } | undefined;
  const caller = env?.inboundCaller;
  return caller && typeof caller === "object" && issued.has(caller as Caller) ? (caller as Caller) : null;
}

/** identity's failures are an outage; everything else a presented key earns is a rejection. */
function reasonFor(why: string): RefusalReason {
  if (/^identity unreachable|^IDENTITY_VESSEL_URL unset|^identity answered HTTP (5\d\d|429)\b/.test(why)) return "identity_unreachable";
  return "key_rejected";
}

/** An UNVERIFIED lead on who was refused, for the count and the log; never an identity. */
function callerHint(c: Context, keyed: boolean, shape: string | undefined): string {
  const claimed = (c.req.header("x-caller-vessel") ?? "").replace(/[^\w:.@\/-]/g, "").slice(0, 64);
  if (claimed) return `claimed:${claimed}`;
  // human_input is posted only by goal-host's solicitHumanInput; the ui*_write panel writes by
  // development-vessel's ui-write-passthrough. By shape, so a lead, not a fact.
  if (shape === "human_input") return keyed ? "goal-host?" : "keyless";
  if (shape === "uiPanel_write" || shape === "uiQuestion_write") return keyed ? "development-vessel?" : "keyless";
  if (!keyed) return c.req.header("Origin") !== undefined ? "keyless-with-origin" : "keyless";
  return "keyed-unknown";
}

function remoteOf(c: Context): string {
  const env = c.env as { requestIP?: (r: Request) => { address?: string } | null } | undefined;
  try {
    return env?.requestIP?.(c.req.raw)?.address || "unknown";
  } catch {
    return "unknown";
  }
}

const refusals = new Map<string, number>();

/** Refusal counts by reason and caller hint, for /health. */
export function inboundAuthCounts(): {
  identity: "configured" | "unset";
  refused: Record<string, Record<string, number>>;
} {
  const refused: Record<string, Record<string, number>> = {};
  for (const [k, n] of refusals) {
    const [reason, hint] = k.split("\t") as [string, string];
    (refused[reason] ??= {})[hint] = n;
  }
  return { identity: IDENTITY_VESSEL_URL ? "configured" : "unset", refused };
}

/** Tests only. */
export function __resetInboundAuthCountsForTests(): void {
  refusals.clear();
}

function refuse(c: Context, what: string, reason: RefusalReason, why: string, hint: string): Response {
  const key = `${reason}\t${hint}`;
  refusals.set(key, (refusals.get(key) ?? 0) + 1);
  console.warn(`[inbound-auth] REFUSED ${what} reason=${reason} caller=${hint} remote=${remoteOf(c)} why=${why}`);
  return c.json({ success: false, error: `caller_credential_required: ${what} is a write; ${why}`, reason }, 401);
}

/**
 * Admit or refuse the caller of a write. `route` is the path the policy is keyed on;
 * `shape` the pointer type where the route carries one.
 */
export async function admitCaller(
  c: Context,
  route: string,
  shape?: string,
): Promise<{ caller: Caller; refused?: undefined } | { caller?: undefined; refused: Response }> {
  const already = carried(c);
  if (already) return { caller: already };
  const what = shape ? `${route} ${shape}` : route;
  const authorization = c.req.header("Authorization");
  const xApiKeyPresented = c.req.header("x-api-key") !== undefined;
  if (authorization !== undefined && authorization.trim() !== "") {
    const cred = await identityCredential(authorization, { xApiKeyPresented });
    if (cred.authenticated) return { caller: keyCaller(cred) };
    const why = cred.why ?? "not authenticated";
    return { refused: refuse(c, what, reasonFor(why), why, callerHint(c, true, shape)) };
  }
  // No key. Ask the module for its reason, so the wording is the fleet's; it calls nobody without a key.
  const keyless = (await identityCredential(undefined, { xApiKeyPresented })).why ?? "no Authorization header";
  const origin = c.req.header("Origin");
  if (origin !== undefined && isOwnOrigin(origin, c.req.url)) {
    if (browserAllowed(route, shape)) return { caller: BROWSER };
    return {
      refused: refuse(c, what, "keyless_not_allowlisted",
        `${keyless}; a keyless same-origin request is accepted only on the browser routes the page calls, and this is not one`,
        callerHint(c, false, shape)),
    };
  }
  return {
    refused: refuse(c, what, "keyless_not_allowlisted",
      `${keyless}; ${origin === undefined ? "no Origin either" : "and the Origin is not this vessel's page"}`,
      callerHint(c, false, shape)),
  };
}

/** The middleware form, for a route whose policy needs no body: admits, then `c.get("inboundCaller")`. */
export function requireCaller(route: string): MiddlewareHandler {
  return async (c, next) => {
    const gate = await admitCaller(c, route);
    if (gate.refused) return gate.refused;
    c.set("inboundCaller" as never, gate.caller as never);
    await next();
  };
}

/** The caller `requireCaller` admitted on this request. */
export function admittedCaller(c: Context): Caller {
  const caller = c.get("inboundCaller" as never) as Caller | undefined;
  if (!caller || !issued.has(caller)) throw new Error("admittedCaller: this route has no requireCaller gate");
  return caller;
}
