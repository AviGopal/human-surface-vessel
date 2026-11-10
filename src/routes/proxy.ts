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
 *   - Every call to another vessel goes THROUGH DISCOVERY by shape
 *     (`viaDiscovery`). The surface holds no producer's address and reads none
 *     from the registry.
 */

import { Hono, type Context, type MiddlewareHandler } from "hono";
import { joinGapThreads, type GapThread } from "../gap-threads.ts";
import { dueForRead, knownState, listOwnDispatches, ownDispatchCount, recordOwnDispatch, rememberState } from "../own-dispatches.ts";
import { admitCaller, admittedCaller, carry, remoteOf, requireCaller, type Caller } from "../inbound-auth.ts";
import { isWritePointerType } from "../caller-credential.ts";
import { impulsesRouter } from "./impulses.ts";
import { getRenderPolicy, personVerdicts, recentSurfaceIntents, recordObservation, recordSurfaceIntent, verdictDelivery, writeRenderPolicy } from "../store.ts";
import { FRAME_MAX_BYTES, frameSessionOf, readFrame, storeFrame } from "../page-frame.ts";
import { arrivedOverTls, closeSession, keySignInAvailable, loginAllowed, loginAtIdentity, mintLabelToken, noteLoginFailure, openSession, sessionOf, signInAvailable, signInWithKey, viewOf, type PersonSession } from "../person-session.ts";
import { VIEW_REGIONS, currentView, type ViewRegion } from "../ui-views.ts";
import { GRAMMAR, parseOnScreen, pinnedShapes, readSurfaceIntent, readViewIntent } from "../surface-intent.ts";
import { corpusVerdict, isGrade, parseWindow, type CalibrationWindow } from "../calibration.ts";
import {
  DISCOVERY_ENDPOINT,
  HOST,
  METABOB_API_KEY,
  PORT,
  RESOLVE_PATH,
  VESSEL_ENDPOINT,
} from "../config.ts";

/** An IP literal: a name no other site can point at this vessel. */
function isIpLiteral(hostname: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.startsWith("[");
}

/**
 * The names this vessel serves under, from its own configuration: the
 * registered self-address, the bind when it names a host, and `localhost`
 * (which no other site can be served from).
 */
export function servedHostnames(endpoint = VESSEL_ENDPOINT, bind = HOST): ReadonlySet<string> {
  const names = new Set<string>(["localhost"]);
  try {
    names.add(new URL(endpoint).hostname);
  } catch {
    /* no registered address */
  }
  if (bind && bind !== "0.0.0.0" && bind !== "::") names.add(bind);
  return names;
}

/**
 * Whether a request's Origin is this vessel's own page: the page was loaded
 * from the same host and port the request was sent to, under a name this
 * vessel serves.
 *
 * The port comes from the request itself, never a port rule. The rule this
 * replaced accepted only PORT and PORT + 10000 (the default 18xxx mapping),
 * so a node publishing under another prefix (8310 → 26310) refused every
 * write from its own page: its run list read "Runs unavailable" and an ask
 * could not be sent.
 *
 * Matching Host alone is not enough: a page on evil.example that re-points its
 * name at this machine (DNS rebinding) sends Origin and Host both as
 * evil.example. So the name must be an IP literal, which cannot be re-pointed,
 * or one this vessel serves.
 */
export function isOwnOrigin(requestOrigin: string, requestUrl: string, served: ReadonlySet<string> = servedHostnames()): boolean {
  try {
    const o = new URL(requestOrigin);
    if (o.protocol !== "http:" && o.protocol !== "https:") return false;
    if (o.host !== new URL(requestUrl).host) return false;
    return isIpLiteral(o.hostname) || served.has(o.hostname);
  } catch {
    return false; // malformed, or the literal "null" a sandboxed or file:// page sends
  }
}

/**
 * No other origin may read these responses. The surface's own page is
 * same-origin and needs no CORS grant, so the header names the vessel itself.
 */
function allowedOrigin(): string {
  return `http://127.0.0.1:${PORT}`;
}

/**
 * A WRITE FROM ANOTHER SITE IS REFUSED BEFORE ANY ROUTE RUNS.
 *
 * CORS governs whether a page may READ a response, not whether its request is
 * sent. A `text/plain` POST is a CORS "simple request": a browser sends it with
 * no preflight, so any page open on this host could make this vessel act — and
 * the proxy forwards to goal-host with the fleet key. Verified 10-02 with a
 * read: `Origin: https://example.invalid` + `text/plain` to `/api/resolve`
 * returned 200 and the dispatch list.
 *
 * Browsers always send `Origin` on a cross-origin POST, so refusing a foreign
 * (or `null`) Origin closes that path. Service-to-service callers send no
 * Origin and are unaffected. This is defence in depth, not authentication:
 * REALIGNMENT §9.0 still requires route auth on every vessel.
 */
export const refuseForeignOriginWrites: MiddlewareHandler = async (c, next) => {
  const method = c.req.method;
  if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
    const origin = c.req.header("Origin");
    if (origin !== undefined && !isOwnOrigin(origin, c.req.url)) {
      return c.json({ error: "cross-origin write refused", origin }, 403);
    }
  }
  await next();
};

/**
 * The shapes this surface's UI resolves through `/api/resolve`, and no others.
 *
 * The route forwards to goal-host with the fleet key, and goal-host's
 * `/resolve` EXECUTES ordinary shapes — `goalDispatchAsync`, any `*_write`.
 * Forwarding any body made this vessel an open, fleet-authenticated executor
 * for whatever reached it. Dispatch has its own route (`/api/run-goal`).
 *
 * Every caller found in the repo stays inside this list (10-02): the UI's own
 * calls in `ui/src/api`, and the demo2 bring-up harness (`activeDispatches`).
 */
const UI_RESOLVE_TYPES: ReadonlySet<string> = new Set([
  "activeDispatches",
  "goalWalkState",
  "vesselCapability",
  "goal_verification_label_write",
  "poolImpulse_write",
  "solicitationResponse_write",
  // Sent while a run's question is on screen, so the walk waits while a person is there.
  "solicitationHeartbeat_write",
  "interactorObservation",
]);

export function resolveTypeOf(raw: string): string | null {
  try {
    const body = JSON.parse(raw) as Record<string, unknown>;
    const t = body["type"];
    return typeof t === "string" && t.length > 0 ? t : null;
  } catch {
    return null;
  }
}

function corsHeaders(_requestOrigin?: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": allowedOrigin(),
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    Vary: "Origin",
  };
}

/**
 * Outbound headers are built from nothing. Never spread the inbound headers —
 * that is what strips `x-caller-vessel`.
 */
function upstreamHeaders(withJsonBody: boolean): Record<string, string> {
  const h: Record<string, string> = {};
  if (withJsonBody) h["Content-Type"] = "application/json";
  if (METABOB_API_KEY) h["Authorization"] = `ApiKey ${METABOB_API_KEY}`;
  return h;
}

// ─── every call to another vessel goes through discovery ────────────────────

/**
 * THE ONE OUTBOUND PATH. Every call this vessel makes to another vessel is
 * `POST <DISCOVERY_ENDPOINT>/resolve {pointer}` under its own key: discovery
 * picks the producer of `pointer.type` from this node's registry by its own
 * rule (a held-data holder, then a policy owner, then a direct row), asks its
 * peers when this node has none, and forwards the call. The surface never reads an address out of a registry row and
 * never holds one of its own, so where a producer runs can change without the
 * surface knowing. The only other outbound calls are to identity (key and
 * sign-in checks) and discovery's own register/deregister.
 */
const DISCOVERY_RESOLVE_TIMEOUT_MS = 10_000;

async function viaDiscovery(
  pointer: Record<string, unknown>,
  opts: { timeoutMs?: number; authorization?: string } = {},
): Promise<Response> {
  const headers = upstreamHeaders(true);
  if (opts.authorization) headers["Authorization"] = opts.authorization;
  return fetch(`${DISCOVERY_ENDPOINT.replace(/\/+$/, "")}/resolve`, {
    method: "POST",
    headers,
    body: JSON.stringify({ pointer }),
    signal: AbortSignal.timeout(opts.timeoutMs ?? DISCOVERY_RESOLVE_TIMEOUT_MS),
  });
}

/**
 * Whether a vessel on this node serves `shape`, from the registry's own words
 * (a local, non-overlay row). An existence test: no address is read from it.
 */
async function servedHere(shape: string): Promise<boolean> {
  let body: Record<string, unknown> | null = null;
  try {
    const res = await viaDiscovery({ type: "vesselRegistry", filters: { shapes: [shape] } }, { timeoutMs: 3_000 });
    const j = (await res.json().catch(() => null)) as null | Record<string, unknown>;
    body = (j?.["content"] ?? j?.["body"] ?? j) as Record<string, unknown> | null;
  } catch {
    return false;
  }
  const rows = Array.isArray(body?.["vessels"]) ? (body["vessels"] as Record<string, unknown>[]) : [];
  return rows.some((v) => v["origin"] === "local" && v["protocol"] !== "libp2p");
}

/** The answer's `body`, or null when discovery or the producer did not answer. */
async function readViaDiscovery(pointer: Record<string, unknown>, timeoutMs?: number): Promise<Record<string, unknown> | null> {
  try {
    const res = await viaDiscovery(pointer, { timeoutMs });
    if (!res.ok) return null;
    const j = JSON.parse(unwrapFederated(await res.text())) as { body?: Record<string, unknown> };
    return j?.body ?? null;
  } catch {
    return null;
  }
}

/**
 * Make a federated answer indistinguishable from a local one.
 *
 * EVERYTHING IS AVAILABLE OVER THE P2P CONNECTION, and this is the function
 * that makes that true for the browser. The relay carries shaped impulses, so a
 * peer's answer comes back wrapped: `{content: {shape, produced_by, body},
 * metadata}`. A local vessel answers `{resolved, shape, body}` directly. The UI
 * checks `resolved === true` and reads `body`, so an unwrapped federated answer
 * throws in `resolveShape` and the board renders its failure banner — with a
 * perfectly good answer sitting inside the response it just rejected.
 *
 * That is the second half of "the surface never shows data": fixing the resolve
 * PATH got the transport to answer, and the answer was still unreadable. The
 * `/api/gaps` route already unwrapped both envelopes; this route did not, and a
 * per-route unwrap is how one of them gets forgotten.
 *
 * Tolerant on purpose — the wrapper is not uniform. When the owner succeeded,
 * `content.body` is the payload; when it failed, `content.body` is the owner's
 * whole `{resolved:false, error}` envelope. Detect which by looking for
 * `resolved`, and never throw: an unrecognised shape passes through untouched
 * so a future envelope degrades to today's behaviour instead of a hard failure.
 */
function unwrapFederated(text: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return text;
  }
  if (typeof parsed !== "object" || parsed === null) return text;
  const outer = parsed as Record<string, unknown>;
  const content = outer["content"];
  if (typeof content !== "object" || content === null) return text;
  const c = content as Record<string, unknown>;

  // A peer that reports its failure inside `content` must stay a failure.
  if (c["error"] !== undefined && c["body"] === undefined) {
    return JSON.stringify({ resolved: false, shape: c["shape"], error: c["error"] });
  }
  const body = c["body"];
  if (typeof body === "object" && body !== null && "resolved" in (body as object)) {
    return JSON.stringify(body);
  }
  if (body === undefined) return text;
  return JSON.stringify({ resolved: true, shape: c["shape"], body });
}

/**
 * The dispatch answer the browser expects, from wherever it came.
 *
 * Local goal-host answers a `goalDispatchAsync` resolve with the run-goal body
 * at the top level (`dispatchId`, and the `refused` / `draining` / `coalesced`
 * flags the UI branches on). Over the relay the same body arrives one level
 * down, in `content.body`. Lift it so one client code path serves both.
 */
function unwrapDispatch(text: string): string {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    if (typeof parsed !== "object" || parsed === null) return text;
    if (parsed["dispatchId"] !== undefined) return text;
    const c = parsed["content"];
    if (typeof c === "object" && c !== null) {
      const inner = (c as Record<string, unknown>)["body"];
      if (typeof inner === "object" && inner !== null && "dispatchId" in (inner as object)) {
        return JSON.stringify(inner);
      }
      const err = (c as Record<string, unknown>)["error"];
      if (err !== undefined) return JSON.stringify({ error: err });
    }
    return text;
  } catch {
    return text;
  }
}

// ─── passthrough ────────────────────────────────────────────────────────────

interface PassthroughOpts {
  url: string;
  method: "GET" | "POST";
  rawBody?: string;
  origin: string | undefined;
  /** Called when the upstream could not be reached at all (not on an upstream error status). */
  onUnreachable?: () => void;
  /** Sent instead of this vessel's own key: a person's on-behalf-of token for one write. */
  authorization?: string;
}

/**
 * Stream the upstream response through with its status and body intact,
 * adding only CORS headers.
 */
async function passthrough(opts: PassthroughOpts): Promise<Response> {
  const { url, method, rawBody, origin } = opts;
  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method,
      headers: opts.authorization ? { ...upstreamHeaders(method === "POST"), Authorization: opts.authorization } : upstreamHeaders(method === "POST"),
      ...(method === "POST" ? { body: rawBody ?? "{}" } : {}),
    });
  } catch (err) {
    opts.onUnreachable?.();
    // Never surface key material or the raw upstream URL's credentials.
    return new Response(
      JSON.stringify({
        error: "upstream unreachable",
        detail: err instanceof Error ? err.message : String(err),
      }),
      {
        status: 502,
        headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
      },
    );
  }

  const headers: Record<string, string> = { ...corsHeaders(origin) };
  const ct = upstream.headers.get("content-type");
  if (ct) headers["Content-Type"] = ct;
  const cc = upstream.headers.get("cache-control");
  if (cc) headers["Cache-Control"] = cc;

  // Status AND body unchanged. 202 / 200+refused / 503+draining all survive.
  return new Response(upstream.body, { status: upstream.status, headers });
}

/**
 * This vessel's own impulse route, IN PROCESS, carrying the caller this route admitted.
 * It used to re-post over HTTP to 127.0.0.1 under the fleet key, which made every
 * browser write arrive as the fleet's own; the shape still travels the one path every
 * record does (the impulse route's case), just without leaving the process.
 */
async function resolveHere(pointer: Record<string, unknown>, caller: Caller, origin: string | undefined): Promise<Response> {
  const res = await impulsesRouter.request(
    RESOLVE_PATH,
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ impulse: { pointer } }) },
    carry(caller),
  );
  const headers: Record<string, string> = { ...corsHeaders(origin) };
  const ct = res.headers.get("content-type");
  if (ct) headers["Content-Type"] = ct;
  return new Response(res.body, { status: res.status, headers });
}

/** What a stored record keeps of the admitted caller (store.ts `CallerStamp`). */
function callerOf(caller: Caller): { origin: string; label: string } {
  return { origin: caller.origin, label: caller.label };
}

async function rawBodyOf(c: { req: { text: () => Promise<string> } }): Promise<string> {
  try {
    const t = await c.req.text();
    return t.length > 0 ? t : "{}";
  } catch {
    return "{}";
  }
}

export const proxyRouter = new Hono();

/**
 * Preflight is handled here because goal-host 404s OPTIONS. Every /api/* path
 * answers preflight, including ones that do not exist upstream — a 404 on
 * preflight reads to a browser as a CORS failure, not a routing error.
 */
proxyRouter.options("/api/*", (c) =>
  c.body(null, 204, corsHeaders(c.req.header("Origin"))),
);

// ─── goal-host ──────────────────────────────────────────────────────────────

/**
 * One resolve call through discovery, buffered so a peer's envelope can be
 * unwrapped: `passthrough` streams the upstream body, and here the body is
 * exactly what needs rewriting.
 */
async function resolveThrough(
  pointer: Record<string, unknown>,
  origin: string | undefined,
  unwrap: (text: string) => string,
): Promise<Response> {
  let upstream: Response;
  try {
    upstream = await viaDiscovery(pointer);
  } catch (err) {
    return new Response(
      JSON.stringify({
        error: "upstream unreachable",
        detail: err instanceof Error ? err.message : String(err),
      }),
      { status: 502, headers: { "Content-Type": "application/json", ...corsHeaders(origin) } },
    );
  }
  const text = await upstream.text();
  return new Response(unwrap(text), {
    status: upstream.status,
    headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
  });
}

/**
 * DISPATCH IS A SHAPE, which is what makes it work over the relay.
 *
 * This used to POST `/run-goal` as plain HTTP, so a spoke whose only
 * `goal_execution` producer was a federated row had nowhere to send a goal —
 * the federation ingress carries shaped impulse resolutions and serves no
 * `/run-goal`. goal-host already advertises `goalDispatchAsync` for exactly
 * this ("lets a remote vault dispatch a goal over the relay"), and resolving it
 * travels the same path every other shape travels.
 *
 * Verified end to end on a UI-only spoke with no local goal host: resolving
 * `goalDispatchAsync` through the ingress returned a dispatchId `produced_by
 * goal-host-vessel@federation-transport-vessel@spoke-cfda39e7`, tagged
 * "proxied to the owning vessel on the peer substrate over libp2p", and the
 * walk was then readable back over the same path with `goalWalkState`.
 *
 * ★ The shape is advertised as `goalDispatchAsync`. goal-host's handler also
 * accepts the snake_case `goal_dispatch_async`, but discovery indexes only the
 * name in its registration — resolving the alias returns "unknown shape: no
 * local or remote producer", which reads as a missing capability and is a
 * missing INDEX ENTRY. Use the advertised spelling.
 */
proxyRouter.post("/api/run-goal", requireCaller("/api/run-goal"), async (c) => {
  const caller = admittedCaller(c);
  // ASKING NEEDS A SIGNED-IN PERSON (user ruling 10-27): an ask from the page carries who
  // asked, so "Mine" is that person's runs. Signed out, it is refused before anything is
  // read or sent upstream, and the page offers sign-in. The person is the session's, which
  // only a sign-in validated by identity creates; nothing in the body names them. A keyed
  // caller is not the page and is named by its key.
  const person = caller.kind === "browser" ? sessionOf(c.req.header("Cookie")) : null;
  if (caller.kind === "browser" && !person) {
    return c.json({ error: "sign_in_required" }, 401, corsHeaders(c.req.header("Origin")));
  }
  const raw = await rawBodyOf(c);
  let req: Record<string, unknown>;
  try {
    req = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    req = {};
  }
  // THE OPERATOR IS THE ADMITTED CALLER'S, never the body's. goal-host keeps it only as an
  // unverified operator_label and takes authority from the credential it is sent (this
  // vessel's). A keyed caller is named by its validated label; the browser, which has no
  // credential until sign-in, by this surface's own label, which is also how the surface
  // finds the runs it asked (backfillOwnDispatches).
  const operator = caller.kind === "browser" ? SURFACE_OPERATOR : caller.label;

  // WHO ASKED, on the tag channel goal-host already reads into the walk's trace tags
  // (body.tags -> effectiveTags -> runGoalWithRecovery): caller:browser-unverified for the
  // page, caller:<validated label> for a key. A caller:* tag in the body is the caller's
  // own claim and is dropped; the body's other tags pass as they did.
  const ownTags = Array.isArray(req["tags"])
    ? (req["tags"] as unknown[]).filter((t): t is string => typeof t === "string" && !t.startsWith("caller:"))
    : [];
  const tags = [...ownTags, `caller:${caller.label}`, ...(person ? [`person:${person.userId}`] : [])];
  // Who asked is the session's, never the body's: a person claimed in the body is dropped, not forwarded.
  for (const k of ["person", "userId", "user_id", "personId", "person_id"]) delete req[k];
  const res = await resolveThrough(
    { ...req, operator, tags, type: "goalDispatchAsync" },
    c.req.header("Origin"),
    unwrapDispatch,
  );
  // Only this surface knows which runs it asked; goal-host cannot list by operator.
  if (res.ok && caller.kind === "browser") {
    try {
      const body = (await res.clone().json()) as { dispatchId?: unknown };
      if (typeof body.dispatchId === "string" && body.dispatchId) {
        recordOwnDispatch({
          dispatchId: body.dispatchId,
          goal: typeof req["goal"] === "string" ? (req["goal"] as string).slice(0, 200) : null,
          operator: SURFACE_OPERATOR,
          startedAt: Date.now(),
          person: person ? { userId: person.userId, name: person.name } : null,
        });
      }
    } catch (err) {
      console.warn(`[human-surface] own-dispatch record failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return res;
});

/**
 * The runs this surface asked, newest first, with their last known state.
 * goal-host is read only for runs whose state is unknown, still running, or
 * finished but not re-checked for five minutes, and at most a few per call.
 * A run goal-host no longer knows (pruned) is left out until it answers.
 */
proxyRouter.get("/api/mine", async (c) => {
  if (ownDispatchCount() === 0) void backfillOwnDispatches();
  // The signed-in person's asks, by the record of who asked. A row recorded before asks
  // carried a person is no one's in particular, so it is in no one's Mine (it stays in All
  // while goal-host lists it). Signed out, there is no "mine".
  const person = sessionOf(c.req.header("Cookie"));
  const rows = person
    ? listOwnDispatches(Number.MAX_SAFE_INTEGER).filter((r) => r.person?.userId === person.userId).slice(0, OWN_LIST_LIMIT)
    : [];
  const now = Date.now();
  await Promise.all(
    dueForRead(rows, now).map(async (id) => {
      const read = await readWalkStateResult(id);
      // goal-host no longer holds it: the kept outcome stands, or the record is gone. Never "running".
      if (read.kind === "gone") return rememberState(id, { status: "gone", reached: null, executionId: null, checkedAt: now });
      const w = read.kind === "state" ? read.body : null;
      const status = w?.["status"];
      if (status === "running" || status === "completed" || status === "failed") {
        rememberState(id, {
          status,
          reached: typeof w?.["reached"] === "boolean" ? (w["reached"] as boolean) : null,
          executionId: typeof w?.["executionId"] === "string" ? (w["executionId"] as string) : null,
          checkedAt: now,
        });
      }
    }),
  );
  const dispatches = rows.flatMap((r) => {
    const s = knownState(r.dispatchId);
    return s
      ? [{ dispatchId: r.dispatchId, goal: r.goal, status: s.status, reached: s.reached, operator: r.operator, trigger: null, startedAt: r.startedAt, learning: null, answerBody: null, own: true, person: r.person ?? null, ...(s.executionId ? { executionId: s.executionId } : {}) }]
      : [];
  });
  return c.json({ resolved: true, shape: "ownDispatches", body: { dispatches } }, 200, corsHeaders(c.req.header("Origin")));
});

/** The operator this surface stamps on what a person asks (TopBar). */
const SURFACE_OPERATOR = "human-surface";
const OWN_LIST_LIMIT = 50;
/** Pages of goal-host's listing a backfill reads, once per process: its whole store is 2,000 rows. */
const BACKFILL_MAX_PAGES = 40;
let backfilling = false;

/**
 * Runs asked before this record existed: read goal-host's listing once, page by
 * page, and keep the ones this surface asked. Once per process, only while the
 * record is empty, never on the poll path's critical path.
 */
async function backfillOwnDispatches(): Promise<void> {
  if (backfilling) return;
  backfilling = true;
  try {
    let offset: number | null = 0;
    for (let page = 0; page < BACKFILL_MAX_PAGES && offset !== null; page++) {
      const res = await viaDiscovery({ type: "activeDispatches", limit: 50, offset });
      if (!res.ok) break;
      const j = JSON.parse(unwrapFederated(await res.text())) as { body?: { dispatches?: Array<Record<string, unknown>>; nextOffset?: number | null } };
      const now = Date.now();
      for (const d of j.body?.dispatches ?? []) {
        // The surface's label is operator_label once goal-host's auth fix is live (operator then
        // carries authority, null for this vessel's key); operator on rows written before it.
        const label = typeof d["operator_label"] === "string" ? d["operator_label"] : d["operator"];
        if (label !== SURFACE_OPERATOR || typeof d["dispatchId"] !== "string") continue;
        const started = typeof d["startedAt"] === "number" ? d["startedAt"] : Date.parse(String(d["startedAt"] ?? ""));
        recordOwnDispatch({
          dispatchId: d["dispatchId"],
          goal: typeof d["goal"] === "string" ? d["goal"] : null,
          operator: SURFACE_OPERATOR,
          startedAt: Number.isFinite(started) ? started : now,
        });
        const status = d["status"];
        if (status === "running" || status === "completed" || status === "failed") {
          rememberState(d["dispatchId"], {
            status,
            reached: typeof d["reached"] === "boolean" ? d["reached"] : null,
            executionId: typeof d["executionId"] === "string" ? d["executionId"] : null,
            checkedAt: now,
          });
        }
      }
      offset = j.body?.nextOffset ?? null;
    }
  } catch (err) {
    console.warn(`[human-surface] own-dispatch backfill stopped: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    backfilling = false;
  }
}

/**
 * One output of a run, whole (goal-host's goalWalkOutput, capped there), for a
 * signed-in person only. The surface forwards under its own key, so an open read
 * would hand anyone who can reach this page every run's full output and undo
 * goal-host's key gate (qa ruling, 10-24). The 2,000-character preview in the
 * run's state stays readable as before.
 */
proxyRouter.get("/api/walk-output", async (c) => {
  if (!sessionOf(c.req.header("Cookie"))) return c.json({ error: "sign in to read full outputs" }, 401);
  const dispatchId = c.req.query("dispatch_id") ?? "";
  const impulseId = c.req.query("impulse_id") ?? "";
  const ok = (v: string) => v.length > 0 && v.length <= 200 && /^[\w.:@-]+$/.test(v);
  if (!ok(dispatchId) || !ok(impulseId)) return c.json({ error: "dispatch_id and impulse_id are required" }, 400);
  return resolveThrough({ type: "goalWalkOutput", dispatchId, impulseId }, c.req.header("Origin"), unwrapFederated);
});

proxyRouter.post("/api/resolve", async (c) => {
  const raw = await rawBodyOf(c);
  const type = resolveTypeOf(raw);
  if (!type || !UI_RESOLVE_TYPES.has(type)) {
    return c.json(
      { error: "shape not resolvable through this surface", type, allowed: [...UI_RESOLVE_TYPES] },
      403,
      corsHeaders(c.req.header("Origin")),
    );
  }
  // Then a caller, by shape (inbound-auth.ts BROWSER_WRITE_ALLOWLIST names the browser's).
  const gate = await admitCaller(c, "/api/resolve", type);
  if (gate.refused) return gate.refused;
  // The body is the pointer (resolveTypeOf has parsed it), and the answer is unwrapped.
  return resolveThrough(JSON.parse(raw) as Record<string, unknown>, c.req.header("Origin"), unwrapFederated);
});

proxyRouter.get("/api/executions/:dispatchId", async (c) => {
  // `goalWalkState` rather than `GET /executions/:id`, for the same reason
  // dispatch is a shape: the HTTP route exists only on a directly-reachable
  // goal host, the shape exists everywhere the relay reaches. (The UI already
  // reads walk state this way through /api/resolve; this route is kept for
  // non-browser callers and now behaves identically.)
  return resolveThrough(
    { type: "goalWalkState", dispatchId: c.req.param("dispatchId") },
    c.req.header("Origin"),
    unwrapFederated,
  );
});

// ─── discovery ──────────────────────────────────────────────────────────────

/**
 * The shape vocabulary, from this node's discovery. Discovery federates its
 * registry with its peers, so the node's registry is the one to read; the
 * surface does not reach past it to another node's.
 *
 * SAY WHETHER IT ANSWERED: `registries` records it, so an unread registry is
 * never shown as an empty vocabulary.
 */
const SHAPES_TIMEOUT_MS = 10_000;

async function readShapesFrom(base: string): Promise<readonly string[] | null> {
  try {
    const res = await fetch(`${base.replace(/\/+$/, "")}/registry/shapes`, {
      headers: upstreamHeaders(false),
      signal: AbortSignal.timeout(SHAPES_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const body = (await res.json().catch(() => null)) as null | { shapes?: unknown };
    if (!Array.isArray(body?.shapes)) return null;
    return body.shapes.filter((s): s is string => typeof s === "string");
  } catch {
    return null;
  }
}

/** The registry's shapes, and whether it answered. */
async function readShapeVocabulary(): Promise<{ union: Set<string>; registries: Array<{ registry: string; ok: boolean; count: number }> }> {
  const shapes = await readShapesFrom(DISCOVERY_ENDPOINT);
  return { union: new Set(shapes ?? []), registries: [{ registry: "local", ok: shapes !== null, count: shapes?.length ?? 0 }] };
}

proxyRouter.get("/api/discovery/shapes", async (c) => {
  const { union, registries } = await readShapeVocabulary();

  // Registry names only — never the resolved URL, which is upstream detail the
  // browser has no use for.
  if (registries.every((r) => !r.ok)) {
    return new Response(JSON.stringify({ error: "shape vocabulary unavailable", registries }), {
      status: 502,
      headers: { "Content-Type": "application/json", ...corsHeaders(c.req.header("Origin")) },
    });
  }

  return new Response(JSON.stringify({ shapes: [...union].sort(), registries }), {
    status: 200,
    headers: { "Content-Type": "application/json", ...corsHeaders(c.req.header("Origin")) },
  });
});

/**
 * A lookup in the registry: this node's discovery, which asks its peers itself
 * when it has no producer for a capability.
 */
/**
 * A READ goes under this node's key. A WRITE goes only under the signed-in person's own key,
 * so the row records the person as its writer; with no person signed in with a key, it is
 * refused here and nothing is sent. A write under the node's key would be the node writing,
 * whatever the row claims, so the page never sends one.
 */
proxyRouter.post("/api/discovery/resolve", requireCaller("/api/discovery/resolve"), async (c) => {
  const rawBody = await rawBodyOf(c);
  const url = `${DISCOVERY_ENDPOINT.replace(/\/+$/, "")}/resolve`;
  let type = "";
  let pointer: unknown = null;
  try {
    pointer = (JSON.parse(rawBody) as { pointer?: unknown }).pointer ?? null;
    const t = (pointer as { type?: unknown } | null)?.type;
    type = typeof t === "string" ? t : "";
  } catch {
    /* not JSON: forwarded as a read, and discovery answers it */
  }
  if (!isWritePointerType(type)) return passthrough({ url, method: "POST", rawBody, origin: c.req.header("Origin") });
  const person = sessionOf(c.req.header("Cookie"));
  if (!person?.apiKey) {
    // What the person tried to write is kept even though it was not sent: a refusal must not
    // lose what the person said (user ruling 10-17). Most often the surface restarted and the
    // in-memory sign-in went with it.
    recordObservation({ type: "person_write", caller: callerOf(admittedCaller(c)), visibility: "operator_only", body: { recorded: false, reason: "sign_in_required", pointer } });
    return c.json({ error: "sign_in_required", reason: "a write is sent only under the signed-in person's own key" }, 401, corsHeaders(c.req.header("Origin")));
  }
  return passthrough({ url, method: "POST", rawBody, origin: c.req.header("Origin"), authorization: `ApiKey ${person.apiKey}` });
});

// ─── human verdicts ───────────────────────────────────

/**
 * A human verdict is NOT a goal-host shape — goal-host's advertised set has no
 * room for it, so `/api/resolve` would reject it. It belongs to activity-api's
 * oracle corpus.
 *
 * `labeler: "human"` is load-bearing rather than decorative: goal-host reads it
 * to decide whether a label may override `reached` and burn the consumption
 * latch. A verdict recorded without it is inert, so the proxy sets it here
 * rather than trusting a browser to.
 */
/**
 * Where a person's label goes and the credential it carries: the producer the registry
 * names for the label write, with an on-behalf-of token minted for that producer's node
 * and this one shape from the person's session. A Response when sign-in isn't available
 * or the token can't be minted.
 */
async function asPersonLabelWrite(c: Context, person: PersonSession): Promise<{ url: string; authorization: string } | Response> {
  const { available, producer } = await signInAvailable();
  if (!available || !producer) return c.json({ success: false, error: "sign-in isn't available on this node" }, 503);
  const minted = await mintLabelToken(person, producer.node);
  if (!minted.ok) return c.json({ success: false, error: minted.error }, minted.status >= 400 ? (minted.status as 400) : 502);
  return { url: producer.url, authorization: `Bearer ${minted.token}` };
}

proxyRouter.post("/api/grade", requireCaller("/api/grade"), async (c) => {
  const body = (await c.req.json().catch(() => null)) as null | Record<string, unknown>;
  const person = sessionOf(c.req.header("Cookie"));
  if (!body || typeof body["execution_id"] !== "string" || typeof body["verdict"] !== "string") {
    return c.json(
      { error: "execution_id and verdict are required" },
      400,
      corsHeaders(c.req.header("Origin")),
    );
  }
  // A verdict is an observation, kept with its source before anything else and
  // whatever the learning corpus does with it: a refusal there must not lose
  // what the person said (user ruling 10-17).
  const kept = recordObservation({
    type: "verdict",
    caller: callerOf(admittedCaller(c)),
    visibility: "operator_only",
    body: {
      dispatch_id: typeof body["dispatch_id"] === "string" ? body["dispatch_id"] : null,
      execution_id: body["execution_id"],
      goal: typeof body["goal"] === "string" ? body["goal"] : null,
      verdict: body["verdict"],
      note: typeof body["notes"] === "string" ? body["notes"] : "",
      judge_reached: typeof body["judge_reached"] === "boolean" ? body["judge_reached"] : null,
      source: "person",
      via: "human-surface",
      // Who, when a person was signed in: the id identity gave them, never the token.
      by: person ? { user_id: person.userId, name: person.name } : null,
      // Which result was judged and where it came from, so a grade confirms or puts
      // in question that result and its provenance (user ruling 10-17).
      about: aboutOf(body["about"]),
    },
  });
  // A HUMAN VERDICT NEEDS A SIGNED-IN PERSON (as an ask does, user ruling 10-27). Signed out,
  // the verdict is kept on the run (above) and nothing is sent: under this vessel's own key
  // the label writer refuses a human verdict, so sending it only produced a refusal.
  if (!person) {
    recordObservation({
      type: "verdict_delivery",
      caller: callerOf(admittedCaller(c)),
      visibility: "operator_only",
      body: { dispatch_id: kept.body?.["dispatch_id"] ?? null, execution_id: body["execution_id"], verdict_at: kept.observedAt, status: 401, recorded: false, reason: "sign_in_required", upstream: null, as: null },
    });
    return c.json({ success: false, error: "sign_in_required" }, 401, corsHeaders(c.req.header("Origin")));
  }
  let unreachable = false;
  // The write goes to the producer the registry names, as the person, with a token
  // minted for that producer's node and this one shape.
  const asPerson = await asPersonLabelWrite(c, person);
  const labelBody = JSON.stringify({
      impulse: {
        pointer: {
          type: "goal_verification_label_write",
          goal: body["goal"] ?? null,
          execution_id: body["execution_id"],
          activity_id: body["activity_id"] ?? "unattributed",
          verdict: body["verdict"],
          // DEFAULT, not passthrough-null. The trace store types this as a float
          // and rejects NULL outright, so forwarding an absent field as null
          // turned every verdict into a 500 the reader saw as "not recorded".
          // A label arriving here is a human's, and a human's verdict is the
          // ground truth this corpus exists to hold — 1 is the honest default,
          // and a caller that means something else can still say so.
          confidence: typeof body["confidence"] === "number" ? body["confidence"] : 1,
          // A string, never null: the label store types `notes` as
          // option<string>, and SurrealDB rejects NULL there, so the whole
          // label is lost. Absent notes are "".
          notes: typeof body["notes"] === "string" ? body["notes"] : "",
          labeler: "human",
        },
      },
    });
  const upstream =
    asPerson instanceof Response
      ? asPerson
      : await passthrough({
          url: asPerson.url,
          method: "POST",
          rawBody: labelBody,
          origin: c.req.header("Origin"),
          onUnreachable: () => (unreachable = true),
          authorization: asPerson.authorization,
        });
  // What upstream answered, kept beside the verdict in its own words, so a
  // refusal reads as "not recorded" after a reload. Observation only: nothing
  // retries the write.
  const text = await upstream.clone().text().catch(() => "");
  let answer: Record<string, unknown> | null = null;
  try {
    answer = JSON.parse(text) as Record<string, unknown>;
  } catch {
    answer = null;
  }
  const recorded = !unreachable && upstream.status >= 200 && upstream.status < 300 && answer?.["success"] !== false;
  const said = typeof answer?.["error"] === "string" ? answer["error"] : typeof answer?.["message"] === "string" ? answer["message"] : null;
  recordObservation({
    type: "verdict_delivery",
    caller: callerOf(admittedCaller(c)),
    visibility: "operator_only",
    body: {
      dispatch_id: kept.body?.["dispatch_id"] ?? null,
      execution_id: body["execution_id"],
      verdict_at: kept.observedAt,
      status: upstream.status,
      recorded,
      reason: unreachable ? "unreachable" : recorded ? null : (said ?? `HTTP ${upstream.status}`).slice(0, 300),
      upstream: "activity-api",
      // Whose credential the write carried: always the signed-in person's.
      as: "person",
    },
  });
  return upstream;
});

// ─── a person signed in on this surface (src/person-session.ts) ──────────────

/** Whether sign-in is offered here, and who is signed in. Never the token. */
proxyRouter.get("/api/session", async (c) => {
  const person = sessionOf(c.req.header("Cookie"));
  const { available } = await signInAvailable();
  return c.json({ available, keySignIn: keySignInAvailable(), signedIn: person !== null, ...(person ? { person: viewOf(person) } : {}) }, 200);
});

/**
 * Sign in: the email and password go to identity once and are not kept. The
 * session token stays in this process; the browser gets a random id in an
 * HttpOnly, SameSite=Strict cookie and what it may show (name, until when).
 */
/**
 * Signing in and out are the page's own acts: a request that does not come from
 * this surface's page (a cross-site form, or a caller with no Origin at all, keyed
 * or not) is refused, so no other site can sign a browser in as someone else.
 */
function fromOwnPage(c: Context): boolean {
  const origin = c.req.header("Origin");
  return origin !== undefined && isOwnOrigin(origin, c.req.url);
}

proxyRouter.post("/api/session/login", requireCaller("/api/session/login"), async (c) => {
  if (!fromOwnPage(c)) return c.json({ error: "sign-in is accepted only from this surface's page" }, 403);
  const { available } = await signInAvailable();
  if (!available) return c.json({ error: "sign-in isn't available on this node" }, 503);
  if (!loginAllowed()) return c.json({ error: "too many attempts; try again in a minute" }, 429);
  const body = (await c.req.json().catch(() => null)) as null | Record<string, unknown>;
  const email = typeof body?.["email"] === "string" ? body["email"].trim() : "";
  const password = typeof body?.["password"] === "string" ? body["password"] : "";
  if (!email || !password || email.length > 320 || password.length > 1024) return c.json({ error: "email and password are required" }, 400);
  const result = await loginAtIdentity(email, password);
  if (!result.ok) {
    if (result.status === 401) noteLoginFailure();
    return c.json({ error: result.error }, result.status as 401);
  }
  const { cookie } = openSession(result.session, Date.now(), arrivedOverTls(c.req.url, c.req.header("X-Forwarded-Proto"), remoteOf(c)));
  recordObservation({ type: "person_session", caller: callerOf(admittedCaller(c)), visibility: "operator_only", body: { event: "signed_in", user_id: result.session.userId } });
  return c.json({ signedIn: true, person: viewOf(result.session) }, 200, { "Set-Cookie": cookie });
});

/**
 * Sign in with the person's own key: it goes to identity once to be checked, then stays in
 * this process for the session, never in the browser, a log or a record. The node's own key
 * is refused: a person's rows must not be written under it.
 */
proxyRouter.post("/api/session/key", requireCaller("/api/session/key"), async (c) => {
  if (!fromOwnPage(c)) return c.json({ error: "sign-in is accepted only from this surface's page" }, 403);
  if (!keySignInAvailable()) return c.json({ error: "sign-in isn't available on this node" }, 503);
  if (!loginAllowed()) return c.json({ error: "too many attempts; try again in a minute" }, 429);
  const body = (await c.req.json().catch(() => null)) as null | Record<string, unknown>;
  const key = typeof body?.["key"] === "string" ? body["key"].trim() : "";
  if (!key || key.length > 1024 || /\s/.test(key)) return c.json({ error: "your key is required" }, 400);
  const result = await signInWithKey(key);
  if (!result.ok) {
    if (result.status === 401 || result.status === 403) noteLoginFailure();
    return c.json({ error: result.error }, result.status as 401);
  }
  const { cookie } = openSession(result.session, Date.now(), arrivedOverTls(c.req.url, c.req.header("X-Forwarded-Proto"), remoteOf(c)));
  recordObservation({ type: "person_session", caller: callerOf(admittedCaller(c)), visibility: "operator_only", body: { event: "signed_in", user_id: result.session.userId, with: "key" } });
  return c.json({ signedIn: true, person: viewOf(result.session) }, 200, { "Set-Cookie": cookie });
});

proxyRouter.post("/api/session/logout", requireCaller("/api/session/logout"), (c) => {
  if (!fromOwnPage(c)) return c.json({ error: "sign-out is accepted only from this surface's page" }, 403);
  const person = sessionOf(c.req.header("Cookie"));
  const cleared = closeSession(c.req.header("Cookie"), arrivedOverTls(c.req.url, c.req.header("X-Forwarded-Proto"), remoteOf(c)));
  if (person) recordObservation({ type: "person_session", caller: callerOf(admittedCaller(c)), visibility: "operator_only", body: { event: "signed_out", user_id: person.userId } });
  return c.json({ signedIn: false }, 200, { "Set-Cookie": cleared });
});

// ─── a page drawn in a frame (src/page-frame.ts) ─────────────────────────────

/**
 * The browser posts the markup it is about to draw as a page; the frame then
 * loads it by URL, so it carries the frame's policy and not the surface's. Only
 * the session that posted a page can load it. Cross-site writes are refused by
 * the app's origin guard before this runs.
 */
/**
 * Who owns a drawn page: the browser's frame session, and the signed-in person when
 * there is one. A page drawn while signed in loads only under that person's session,
 * so it does not outlive their sign-out or open in someone else's.
 */
function frameOwner(cookieHeader: string | undefined): string | null {
  const frame = frameSessionOf(cookieHeader);
  if (!frame) return null;
  const person = sessionOf(cookieHeader);
  return person ? `${frame}|${person.userId}` : frame;
}

proxyRouter.post("/api/page-frame", requireCaller("/api/page-frame"), async (c) => {
  const session = frameOwner(c.req.header("Cookie"));
  if (!session) return c.json({ error: "no frame session" }, 401);
  const body = (await c.req.json().catch(() => null)) as null | { source?: unknown };
  if (typeof body?.source !== "string") return c.json({ error: "source required" }, 400);
  if (Buffer.byteLength(body.source, "utf8") > FRAME_MAX_BYTES) return c.json({ error: "too large" }, 413);
  return c.json({ id: storeFrame(session, body.source, Date.now(), callerOf(admittedCaller(c))) }, 200);
});

proxyRouter.get("/api/page-frame/:id", (c) => {
  const id = c.req.param("id");
  const doc = /^[0-9a-f]{64}$/.test(id) ? readFrame(frameOwner(c.req.header("Cookie")), id) : null;
  if (!doc) return c.json({ error: "not found" }, 404);
  return new Response(doc, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Cache-Control": "no-store",
    },
  });
});

// ─── gap threads (browser read) ─────────────────────────────────────────────

/**
 * The system's own work on its gaps, as threads: each gap with the attempts the
 * attempt ledger recorded for it, their runs, verdicts and commits.
 *
 * NODE-LOCAL by design: read only when a vessel on this node serves the ledger
 * (with no row that outranks it, discovery answers from it), because the ledger is where this node's lane wrote. Joined here, once per minute,
 * never in the browser: the ledger is megabytes.
 */
let gapThreadsCache: { at: number; body: unknown } | null = null;
const GAP_THREADS_TTL_MS = 60_000;

proxyRouter.get("/api/gap-threads", async (c) => {
  if (gapThreadsCache && Date.now() - gapThreadsCache.at < GAP_THREADS_TTL_MS) {
    return c.json(gapThreadsCache.body, 200, corsHeaders(c.req.header("Origin")));
  }
  // Sequential: 3 s + 8 s + 8 s, under the server's 30 s idle timeout, so the 502 below is reachable.
  const gaps = (await servedHere("attemptLedger")) ? await readViaDiscovery({ type: "substrateGap", limit: 500 }, 8_000) : null;
  if (!gaps || !Array.isArray(gaps["gaps"])) {
    return c.json({ resolved: false, error: "no vessel serving substrateGap and attemptLedger answered" }, 502, corsHeaders(c.req.header("Origin")));
  }
  const kind = async (k: string): Promise<Record<string, unknown>[]> => {
    const b = await readViaDiscovery({ type: "attemptLedger", kind: k }, 8_000);
    const records = Array.isArray(b?.["records"]) ? (b["records"] as Array<{ record?: Record<string, unknown> }>) : [];
    return records.map((r) => r.record ?? {});
  };
  const [intents, outcomes, settlements] = await Promise.all([kind("attemptIntent"), kind("attemptOutcome"), kind("attemptSettlement")]);
  const threads: GapThread[] = joinGapThreads(gaps["gaps"] as Record<string, unknown>[], intents, outcomes, settlements);
  const body = {
    resolved: true,
    shape: "attemptLedger",
    body: {
      scope: "this node",
      threads,
      totals: {
        attempts: intents.length,
        landed: outcomes.filter((o) => o["landed"] === true).length,
        withRun: intents.filter((i) => typeof i["dispatch_id"] === "string" && i["dispatch_id"]).length,
      },
    },
  };
  gapThreadsCache = { at: Date.now(), body };
  return c.json(body, 200, corsHeaders(c.req.header("Origin")));
});

/** For tests: drop the cached join. */
export function resetGapThreadsCacheForTest(): void {
  gapThreadsCache = null;
}

/** The judged result as the page names it: plain strings only, nothing else kept. */
function aboutOf(v: unknown): Record<string, string> | null {
  if (!v || typeof v !== "object") return null;
  const out: Record<string, string> = {};
  for (const k of ["pool_id", "shape", "produced_by", "provenance"]) {
    const x = (v as Record<string, unknown>)[k];
    if (typeof x === "string" && x.length <= 200) out[k] = x;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** Verdicts kept on a run (or the newest across runs), for the run page and the thread mark. */
proxyRouter.get("/api/verdicts", (c) => {
  const id = c.req.query("dispatch_id") || undefined;
  const verdicts = personVerdicts(id).map((o) => {
    const d = typeof o.body?.["dispatch_id"] === "string" ? verdictDelivery(o.body["dispatch_id"] as string, o.observedAt) : undefined;
    return { ...o.body, observedAt: o.observedAt, ...(d ? { delivery: { recorded: d["recorded"] === true, status: d["status"] ?? null, reason: d["reason"] ?? null } } : {}) };
  });
  return c.json({ resolved: true, shape: "interactorObservation", body: { verdicts } }, 200, corsHeaders(c.req.header("Origin")));
});

// ─── interface gaps (browser read) ──────────────────────────────────────────

/**
 * The surface renders the gap store's view of ITSELF.
 *
 * These are `ui_legibility` gaps: some `substrate_detected` by the substrate's
 * own legibility scan reading this surface, some `human_reported` from a person
 * complaining about it. They share one keyspace on purpose, so a reader can see
 * both kinds of finding in one place — and can watch one close.
 */
proxyRouter.get("/api/gaps", async (c) => {
  // By shape, through discovery, which places the read wherever a gap store runs.
  const answer = await readViaDiscovery({ type: "substrateGap", category: "ui_legibility", limit: 40 }, 8_000);
  if (answer && Array.isArray(answer["gaps"])) return c.json({ gaps: answer["gaps"] }, 200, corsHeaders(c.req.header("Origin")));

  return c.json(
    { gaps: [], error: "no vessel serving substrateGap answered" },
    502,
    corsHeaders(c.req.header("Origin")),
  );
});

// ─── human feedback (browser write) ─────────────────────────────────────────

/**
 * A complaint about this surface, from the person looking at it.
 *
 * It self-posts the `uiFeedback` SHAPE rather than calling the store directly,
 * so a complaint travels the same path a complaint from anywhere else would —
 * one code path, one place for the gap-filing side effect to live.
 */
/**
 * One gap by id, from whichever vessel serves `substrateGap`: `{found, gap}`,
 * or null when no vessel serving it answered.
 */
export async function readGapById(id: string): Promise<{ found: boolean; gap: unknown } | null> {
  const answer = await readViaDiscovery({ type: "substrateGap", id, limit: 1 }, 4_000);
  const gaps = Array.isArray(answer?.["gaps"]) ? (answer["gaps"] as unknown[]) : null;
  if (!gaps) return null;
  const gap = gaps.find((g) => (g as { id?: unknown })?.id === id) ?? null;
  return { found: gap !== null, gap };
}

/**
 * The status of the gaps questions ask about, read in the background.
 *
 * The questions read marks a question whose gap has closed so the rail does not
 * present it as waiting (14 of 20 escalations on one node were about closed
 * gaps). The gap store answers one id per read, so statuses are cached here and
 * refreshed off the request path: the questions read never waits on it, and a
 * status not yet read is unknown, never "closed".
 */
const GAP_STATUS_TTL_MS = 10 * 60_000;
const GAP_STATUS_CONCURRENCY = 4;
const GAP_STATUS_MAX_PER_READ = 60;
const gapStatuses = new Map<string, { status: string | null; at: number }>();
const gapStatusInFlight = new Set<string>();

/** The cached status of a gap, or null when it has not been read (or was not found). */
export function knownGapStatus(id: string): string | null {
  return gapStatuses.get(id)?.status ?? null;
}

/** Read the statuses of these gaps that are not cached or are stale. Never throws; resolves when done. */
export async function refreshGapStatuses(ids: readonly string[]): Promise<void> {
  const now = Date.now();
  const due = [...new Set(ids)]
    .filter((id) => !gapStatusInFlight.has(id) && now - (gapStatuses.get(id)?.at ?? 0) > GAP_STATUS_TTL_MS)
    .slice(0, GAP_STATUS_MAX_PER_READ);
  for (const id of due) gapStatusInFlight.add(id);
  const queue = [...due];
  const worker = async (): Promise<void> => {
    for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
      try {
        const answer = await readGapById(id);
        // No vessel answered: leave it unknown and try again on a later read.
        if (answer) {
          const status = answer.found ? (answer.gap as { status?: unknown } | null)?.status : null;
          gapStatuses.set(id, { status: typeof status === "string" ? status : null, at: Date.now() });
        }
      } finally {
        gapStatusInFlight.delete(id);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(GAP_STATUS_CONCURRENCY, due.length) }, worker));
}

/**
 * One gap by id, from whichever vessel serves `substrateGap`.
 *
 * The question view reads the escalated gap back after a person answers, so the
 * card can say whether the answer was applied (`human_disposition_record_id`
 * equals the answer's response id), replaced by a later one, or not yet applied.
 */
proxyRouter.get("/api/gaps/:id", async (c) => {
  const id = c.req.param("id");
  const origin = c.req.header("Origin");
  if (!id || id.length > 300) return c.json({ error: "gap id required" }, 400, corsHeaders(origin));
  const answer = await readGapById(id);
  if (answer) {
    const status = answer.found ? (answer.gap as { status?: unknown } | null)?.status : null;
    gapStatuses.set(id, { status: typeof status === "string" ? status : null, at: Date.now() });
    return answer.found
      ? c.json({ gap: answer.gap }, 200, corsHeaders(origin))
      : c.json({ gap: null, error: "no gap with that id" }, 404, corsHeaders(origin));
  }
  return c.json({ gap: null, error: "no vessel serving substrateGap answered" }, 502, corsHeaders(origin));
});

proxyRouter.post("/api/feedback", requireCaller("/api/feedback"), async (c) => {
  const body = (await c.req.json().catch(() => null)) as null | Record<string, unknown>;
  if (!body || typeof body["panel_id"] !== "string" || !body["value"]) {
    return c.json(
      { error: "panel_id and value are required" },
      400,
      corsHeaders(c.req.header("Origin")),
    );
  }
  return resolveHere(
    {
      type: "uiFeedback",
      panel_id: body["panel_id"],
      value: body["value"],
      kind: "reaction",
      complaint_kind: body["kind"] ?? "wrong",
      visibility: "public",
    },
    admittedCaller(c),
    c.req.header("Origin"),
  );
});

// ─── exposure record (browser write) ────────────────────────────────────────

/**
 * What the surface actually PUT ON SCREEN, and what the person then did with it.
 *
 * The endpoint `ui/src/api/exposure.ts` posts to, wired here rather than left a
 * 404: the record was already produced by the browser and dropped on the floor,
 * and a learner with no evidence source can only confirm its own ranking.
 *
 * It self-posts the `interactorObservation` SHAPE exactly as /api/feedback
 * self-posts `uiFeedback`, so a record from the browser travels the same single
 * path a record from anywhere else does — which is also why the learner's
 * trigger lives at that one shape case and not here.
 *
 * NOT `uiFeedback`, EVER: every record from here is machine-origin by
 * construction, and that channel is human contributions only (48 machine-written
 * records polluted the operator-verdict corpus once, and
 * development-vessel/src/resolvers/interactor-passthrough.ts:72 now refuses
 * them). Nothing in this route touches it.
 */
proxyRouter.post("/api/observations", requireCaller("/api/observations"), async (c) => {
  const body = (await c.req.json().catch(() => null)) as null | Record<string, unknown>;
  if (!body || typeof body["obs_type"] !== "string") {
    return c.json(
      { error: "obs_type is required" },
      400,
      corsHeaders(c.req.header("Origin")),
    );
  }
  // The pointer is forwarded WHOLE. The shape case names the columns it reads
  // and persists the remainder verbatim, so a field this route has never heard
  // of reaches the corpus instead of being filtered out by a stale allowlist
  // here — two places that both have to know the field list is how a producer
  // and its consumer diverge.
  return resolveHere(
    {
      ...body,
      type: "interactorObservation",
      visibility: body["visibility"] ?? "operator_only",
    },
    admittedCaller(c),
    c.req.header("Origin"),
  );
});

// ─── render policy (browser read) ───────────────────────────────────────────

/**
 * The browser reads the behaviour impulse here, on every poll. This is the
 * whole point of rule law-1 for a surface: the render decision is a use-time
 * lookup against a shaped impulse, so changing the impulse changes the
 * interface with no rebuild, no deploy, and a trace of who changed it.
 */
proxyRouter.get("/api/render-policy", (c) =>
  c.json(getRenderPolicy(), 200, corsHeaders(c.req.header("Origin"))),
);

/** The view a region draws now (src/ui-views.ts): read by the page at use time, as the policy is. */
proxyRouter.get("/api/ui-view", (c) => {
  const region = c.req.query("region") ?? "";
  if (!Object.hasOwn(VIEW_REGIONS, region)) return c.json({ error: "unknown_region" }, 404);
  return c.json(currentView(region as ViewRegion), 200, corsHeaders(c.req.header("Origin")));
});

// ─── typed instruction → interface change (browser write) ───────────────────

/**
 * The prose box. A person types "make the text bigger and show shellResult as
 * a table" and the interface changes.
 *
 * Resolved IN PROCESS rather than by dialling this vessel's own resolver over
 * HTTP, and that is the security-boundary decision this file exists to make:
 * a self-loopback would either need the API key in a request the browser can
 * see the shape of, or would have to trust an address the vessel advertises but
 * cannot always dial (goal-host hit exactly that wall from outside the
 * container). Calling the parser directly keeps the key server-side by
 * construction — there is no outbound request to attach it to.
 *
 * `text` is the ONLY input accepted. The browser never sends a policy patch:
 * if it could, a hostile page could set any token to any value while the
 * response would still read as a human instruction. Everything the surface can
 * be told to do must survive the parser.
 */
/** An instruction about this interface is a sentence or two; the cap keeps the readers cheap. */
const SURFACE_INTENT_MAX_CHARS = 2_000;

proxyRouter.post("/api/surface-intent", requireCaller("/api/surface-intent"), async (c) => {
  const origin = c.req.header("Origin");
  const body = (await c.req.json().catch(() => null)) as null | Record<string, unknown>;
  const raw = body?.["text"] ?? body?.["instruction"];
  const text = typeof raw === "string" ? raw : "";
  // Before any reader runs: every reader here is synchronous on the event loop.
  if (text.length > SURFACE_INTENT_MAX_CHARS) {
    return c.json({ applied: false, understood: false, error: "too long" }, 413, corsHeaders(origin));
  }
  if (text.trim() === "") {
    return c.json(
      { applied: false, understood: false, error: "text required", grammar: GRAMMAR },
      400,
      corsHeaders(origin),
    );
  }

  // About the output on screen: a whole-ask reading that changes one view and writes no policy.
  const view = readViewIntent(text, parseOnScreen(body?.["onScreen"]));
  if (view?.kind === "view") {
    return c.json({ applied: false, understood: true, view: { shape: view.shape, form: view.form, region: view.region } }, 200, corsHeaders(origin));
  }
  if (view?.kind === "refused") {
    recordObservation({
      type: "surface_intent_refused",
      caller: callerOf(admittedCaller(c)),
      visibility: "operator_only",
      body: { text, reason: view.reason, shape: view.shape, region: view.region, origin: "box" },
    });
    return c.json({ applied: false, understood: true, refused: { reason: view.reason } }, 200, corsHeaders(origin));
  }

  const reading = readSurfaceIntent(text, getRenderPolicy());

  // A pin names a shape the registry knows, or the sentence was about something
  // else and is a goal. Unread registries prove nothing, so they refuse the pin too.
  const named = pinnedShapes(reading);
  if (named.length > 0) {
    const { union } = await readShapeVocabulary();
    const unknown = named.filter((n) => !union.has(n));
    if (unknown.length > 0) {
      recordSurfaceIntent({ text, changedFields: [], unparsed: [text], appliedRevision: null });
      return c.json(
        { applied: false, understood: false, changes: [], unparsed: [], error: `not a shape: ${unknown.join(", ")}` },
        422,
        corsHeaders(origin),
      );
    }
  }

  if (!reading.understood) {
    recordSurfaceIntent({
      text,
      changedFields: [],
      unparsed: reading.unparsed.map((u) => u.text),
      appliedRevision: null,
    });
    // 422, not 200: the reader asked for something and it did not happen.
    // `suggested_goal` rides along so the surface can OFFER a dispatch — P2
    // says a suggestion inserts into the input, it never sends. Nothing here
    // dispatches, and nothing here may be changed to.
    return c.json(
      {
        applied: false,
        understood: false,
        changes: [],
        unparsed: reading.unparsed,
        grammar: reading.grammar,
        policy: getRenderPolicy(),
      },
      422,
      corsHeaders(origin),
    );
  }

  const write = writeRenderPolicy(reading.patch);
  if (!write.changed) {
    // Understood, and already in force. 422 for the same reason as the branch
    // above: the reader asked for something and nothing happened, so nothing
    // may be reported as applied. The revision does not move either.
    recordSurfaceIntent({
      text,
      changedFields: [],
      unparsed: reading.unparsed.map((u) => u.text),
      appliedRevision: null,
    });
    return c.json(
      {
        applied: false,
        understood: true,
        changes: [],
        unparsed: reading.unparsed,
        error: write.refusal?.reason ?? "this instruction moved no field",
        policy: write.policy,
      },
      422,
      corsHeaders(origin),
    );
  }
  const next = write.policy;
  recordSurfaceIntent({
    text,
    changedFields: reading.changes.map((ch) => ch.field),
    unparsed: reading.unparsed.map((u) => u.text),
    appliedRevision: next.revision,
  });
  return c.json(
    {
      applied: true,
      understood: true,
      partial: reading.unparsed.length > 0,
      changes: reading.changes,
      unparsed: reading.unparsed,
      ...(reading.unparsed.length > 0 ? { grammar: reading.grammar } : {}),
      policy: next,
    },
    200,
    corsHeaders(origin),
  );
});

/** What the box understands, so the surface can say so without guessing. */
proxyRouter.get("/api/surface-intent/grammar", (c) =>
  c.json(
    { grammar: GRAMMAR, recent: recentSurfaceIntents(20) },
    200,
    corsHeaders(c.req.header("Origin")),
  ),
);

// ─── calibration (blind grading of a declared sample) ────────────────────────

/**
 * Open calibration windows from THIS substrate's standing pool. Each row is
 * re-validated on every read (see `parseWindow`) and nothing is cached, so a
 * window that closes or is retired stops being gradable at once.
 */
async function readCalibrationWindows(now = Date.now()): Promise<{ windows: CalibrationWindow[]; reason: string | null }> {
  // A peer's row would be attested by a peer's operator, whose authority here is nil, so
  // the read is made only when this node itself serves the pool. With no row that outranks
  // it by policy, discovery then answers the resolve below from that producer.
  if (!(await servedHere("poolImpulse"))) return { windows: [], reason: "no producer" };
  try {
    const res = await viaDiscovery({ type: "poolImpulse", shape: "calibrationWindow", status: "open" }, { timeoutMs: 4_000 });
    if (!res.ok) return { windows: [], reason: "unreadable" };
    const j = JSON.parse(unwrapFederated(await res.text())) as { body?: { impulses?: unknown[] } };
    const rows = Array.isArray(j.body?.impulses) ? j.body.impulses : [];
    const windows: CalibrationWindow[] = [];
    let reason: string | null = rows.length === 0 ? "no window" : null;
    for (const row of rows) {
      const parsed = parseWindow(row, now);
      if (parsed.ok) windows.push(parsed.window);
      else reason ??= parsed.reason;
    }
    return { windows, reason: windows.length > 0 ? null : reason };
  } catch {
    return { windows: [], reason: "unreadable" };
  }
}

proxyRouter.get("/api/calibration/windows", async (c) => {
  const { windows, reason } = await readCalibrationWindows();
  return c.json({
    windows: windows.map((w) => ({
      window_id: w.windowId,
      sample_draw_id: w.sampleDrawId,
      seed: w.seed,
      label_sink: w.labelSink,
      closes_at: w.closesAt,
      dispatch_ids: w.dispatchIds,
    })),
    reason,
  });
});

/**
 * A calibration grade. Re-checked here against a fresh read of the window,
 * whatever the browser believes: the dispatch must be in an attested open
 * window whose sink is "system". Anything else writes nothing.
 */
proxyRouter.post("/api/calibration/grade", requireCaller("/api/calibration/grade"), async (c) => {
  const body = (await c.req.json().catch(() => null)) as null | Record<string, unknown>;
  const windowId = typeof body?.["window_id"] === "string" ? body["window_id"] : null;
  const dispatchId = typeof body?.["dispatch_id"] === "string" ? body["dispatch_id"] : null;
  const grade = body?.["grade"];
  if (!windowId || !dispatchId || !isGrade(grade)) {
    return c.json({ error: "window_id, dispatch_id and grade are required" }, 400);
  }
  // A calibration grade is a human verdict: it needs a signed-in person, and is refused
  // before anything is read or sent when nobody is (under this vessel's key it was refused).
  const person = sessionOf(c.req.header("Cookie"));
  if (!person) return c.json({ error: "sign_in_required" }, 401);
  const { windows } = await readCalibrationWindows();
  const w = windows.find((x) => x.windowId === windowId);
  if (!w) return c.json({ error: "no open window" }, 404);
  if (!w.dispatchIds.includes(dispatchId)) return c.json({ error: "not in the sample" }, 403);
  if (w.labelSink !== "system") return c.json({ error: "report only" }, 409);
  const walk = await readWalkState(dispatchId);
  const executionId = typeof walk?.["executionId"] === "string" ? (walk["executionId"] as string) : null;
  if (!executionId) return c.json({ error: "no execution id" }, 409);
  // "" not null: the label store rejects NULL in option<string> (see /api/grade).
  const notes = typeof body?.["notes"] === "string" ? body["notes"].trim() : "";
  const asPerson = await asPersonLabelWrite(c, person);
  if (asPerson instanceof Response) return asPerson;
  return passthrough({
    url: asPerson.url,
    method: "POST",
    authorization: asPerson.authorization,
    rawBody: JSON.stringify({
      impulse: {
        pointer: {
          type: "goal_verification_label_write",
          goal: typeof walk?.["goal"] === "string" ? walk["goal"] : null,
          execution_id: executionId,
          activity_id: "unattributed",
          verdict: corpusVerdict(grade),
          confidence: 1,
          notes,
          labeler: "human",
          purpose: "calibration",
          window_id: w.windowId,
          sample_draw_id: w.sampleDrawId,
        },
      },
    }),
    origin: c.req.header("Origin"),
  });
});

/**
 * READ a run's walk state from goal-host — never a write. Used to verify that a
 * question claiming to come from a run really belongs to a running walk before
 * the surface links the two (this vessel's write routes are unauthenticated, so
 * a forged `dispatch_id` must not be able to put a question on a run).
 * Null when goal-host does not answer or does not know the dispatch.
 */
/**
 * A run's state, or whether goal-host said it does not hold the run ("gone"), or
 * could not be asked at all. The two failures differ: a run goal-host no longer has
 * will never answer again, and one that could not be reached may next time.
 */
export async function readWalkStateResult(dispatchId: string): Promise<{ kind: "state"; body: Record<string, unknown> } | { kind: "gone" } | { kind: "unreachable" }> {
  try {
    const res = await viaDiscovery({ type: "goalWalkState", dispatchId });
    const j = JSON.parse(unwrapFederated(await res.text())) as { resolved?: boolean; body?: unknown; error?: unknown };
    if (j.resolved === true && j.body && typeof j.body === "object") return { kind: "state", body: j.body as Record<string, unknown> };
    if (typeof j.error === "string" && /dispatch not found/i.test(j.error)) return { kind: "gone" };
    return { kind: "unreachable" };
  } catch {
    return { kind: "unreachable" };
  }
}

export async function readWalkState(dispatchId: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await viaDiscovery({ type: "goalWalkState", dispatchId });
    if (!res.ok) return null;
    const j = JSON.parse(unwrapFederated(await res.text())) as { resolved?: boolean; body?: unknown };
    return j.resolved === true && j.body && typeof j.body === "object" ? (j.body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export { corsHeaders };
export default proxyRouter;
