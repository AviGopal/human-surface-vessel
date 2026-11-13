/**
 * The browser proxy — a SECURITY BOUNDARY, not a CORS shim.
 *
 * The browser reaches other vessels only through this file, and only through
 * discovery. The API key must NEVER reach the browser: it is injected
 * server-side here and never echoed into a response body.
 *
 * Other load-bearing properties:
 *
 *   - Upstream status and body are returned UNCHANGED. `202`, `200` with
 *     `refused:true`, and `503` with `draining:true` are each distinct signals
 *     to the client's poll loop; re-wrapping them destroys information. The
 *     upstream body is streamed through, never parsed and rebuilt.
 *   - Outbound headers are CONSTRUCTED, never forwarded. That strips any
 *     inbound `x-caller-vessel` and everything else a hostile page might try
 *     to smuggle.
 *   - Every call to another vessel goes THROUGH DISCOVERY by shape
 *     (`viaDiscovery`). The surface holds no producer's address and reads none
 *     from the registry.
 */

import { Hono, type Context, type MiddlewareHandler } from "hono";
import { admittedCaller, carry, remoteOf, requireCaller, type Caller } from "../inbound-auth.ts";
import { isWritePointerType } from "../caller-credential.ts";
import { impulsesRouter } from "./impulses.ts";
import { getRenderPolicy, recentSurfaceIntents, recordObservation, recordSurfaceIntent, writeRenderPolicy } from "../store.ts";
import { FRAME_MAX_BYTES, frameSessionOf, readFrame, storeFrame } from "../page-frame.ts";
import { unnamed, unnamePeople } from "../unname.ts";
import { arrivedOverTls, closeSession, keySignInAvailable, loginAllowed, noteLoginFailure, openSession, sessionOf, signInWithKey, viewOf } from "../person-session.ts";
import { VIEW_REGIONS, currentView, type ViewRegion } from "../ui-views.ts";
import { GRAMMAR, parseOnScreen, pinnedShapes, readSurfaceIntent, readViewIntent } from "../surface-intent.ts";
import {
  DISCOVERY_ENDPOINT,
  HOST,
  METABOB_API_KEY,
  PORT,
  RESOLVE_PATH,
  publicOrigin,
} from "../config.ts";

/** An IP literal: a name no other site can point at this vessel. */
function isIpLiteral(hostname: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.startsWith("[");
}

/**
 * The names this vessel serves under, over any scheme: `localhost` (which no
 * other site can be served from) and the bind when it names a host. A name
 * people reach from outside is not one of these: it is the deployment's public
 * address, accepted only as that exact https origin (publicOrigin, config.ts),
 * so one stated fact decides it and plain http on the same name never passes.
 */
export function servedHostnames(bind = HOST): ReadonlySet<string> {
  const names = new Set<string>(["localhost"]);
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
export function isOwnOrigin(requestOrigin: string, requestUrl: string, served: ReadonlySet<string> = servedHostnames(), published: string | null = publicOrigin()): boolean {
  try {
    const o = new URL(requestOrigin);
    if (o.protocol !== "http:" && o.protocol !== "https:") return false;
    if (o.host !== new URL(requestUrl).host) return false;
    // The deployment's public address, when it states one: that exact origin, scheme and port
    // included, so the same name over plain http is not it. The request's host is the Host the
    // proxy passed on; no X-Forwarded-* header is read.
    if (published !== null && o.origin === published) return true;
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
 * no preflight, so any page open on this host could make this vessel act, and
 * a forwarding route would send it on with the fleet key. Verified 10-02: a
 * foreign-Origin `text/plain` POST to the forwarding route of the time
 * returned 200 and the dispatch list.
 *
 * Browsers always send `Origin` on a cross-origin POST, so refusing a foreign
 * (or `null`) Origin closes that path. Service-to-service callers send no
 * Origin and are unaffected. This is defence in depth, not authentication:
 * REALIGNMENT §9.0 still requires route auth on every vessel.
 */
/**
 * Whether the session cookie is marked Secure: always when the deployment states a public address
 * (it is https only, so the person reaches it over TLS, whatever scheme the proxy used to reach
 * this process), and otherwise when this request arrived over TLS.
 */
function cookieSecure(c: Context): boolean {
  return publicOrigin() !== null || arrivedOverTls(c.req.url, c.req.header("X-Forwarded-Proto"), remoteOf(c));
}

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
    signal: AbortSignal.timeout(opts.timeoutMs ?? getRenderPolicy().timeouts.resolveMs),
  });
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
 * Preflight is answered here, not by any producer. Every /api/* path answers preflight, including ones that do not exist upstream — a 404 on
 * preflight reads to a browser as a CORS failure, not a routing error.
 */
proxyRouter.options("/api/*", (c) =>
  c.body(null, 204, corsHeaders(c.req.header("Origin"))),
);

// ─── discovery ──────────────────────────────────────────────────────────────

/**
 * The shape vocabulary, from this node's discovery. Discovery federates its
 * registry with its peers, so the node's registry is the one to read; the
 * surface does not reach past it to another node's.
 *
 * SAY WHETHER IT ANSWERED: `registries` records it, so an unread registry is
 * never shown as an empty vocabulary.
 */
async function readShapesFrom(base: string): Promise<readonly string[] | null> {
  try {
    const res = await fetch(`${base.replace(/\/+$/, "")}/registry/shapes`, {
      headers: upstreamHeaders(false),
      signal: AbortSignal.timeout(getRenderPolicy().timeouts.shapesMs),
    });
    if (!res.ok) return null;
    const body = (await res.json().catch(() => null)) as null | { shapes?: unknown };
    if (!Array.isArray(body?.shapes)) return null;
    return body.shapes.filter((s): s is string => typeof s === "string");
  } catch {
    return null;
  }
}

/**
 * The shapes this node's discovery lists right now, or null when it did not answer. A question's
 * declared reader counts only while it is listed here (src/question-class.ts).
 */
export async function listedShapes(): Promise<ReadonlySet<string> | null> {
  const { union, registries } = await readShapeVocabulary();
  return registries.every((r) => r.ok) ? union : null;
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
 * A lookup through this node's discovery, which asks its peers itself when it has no producer
 * for a shape. It goes only under the caller's OWN credential: the key a service caller presented
 * (admitted above, so identity has validated it), or the signed-in person's own key. Identity and
 * the producers' PERMISSIONS then decide what that caller may resolve, read or write. With neither,
 * it is refused here and nothing is sent: this vessel's own key never carries a caller's lookup,
 * since a lookup under it would be the node asking, whatever the caller is (a shell or git tool
 * among them).
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
    /* not JSON: sent as it came, and discovery answers it */
  }
  const person = sessionOf(c.req.header("Cookie"));
  const presented = c.req.header("Authorization")?.trim();
  const authorization = presented ? presented : person?.apiKey ? `ApiKey ${person.apiKey}` : null;
  if (authorization === null) {
    // What the person tried to write is kept even though it was not sent: a refusal must not
    // lose what the person said (user ruling 10-17). Most often the surface restarted and the
    // in-memory sign-in went with it.
    if (isWritePointerType(type)) {
      recordObservation({ type: "person_write", caller: callerOf(admittedCaller(c)), visibility: "operator_only", body: { recorded: false, reason: "sign_in_required", pointer } });
    }
    return c.json({ error: "sign_in_required", reason: "a lookup is sent only under the caller's own key: sign in" }, 401, corsHeaders(c.req.header("Origin")));
  }
  const sent = await passthrough({ url, method: "POST", rawBody, origin: c.req.header("Origin"), authorization });
  return isWritePointerType(type) ? sent : unnamed(sent, person?.userId ?? null);
});

// ─── a person signed in on this surface (src/person-session.ts) ──────────────

/** Whether sign-in is offered here, and who is signed in. Never the token. */
proxyRouter.get("/api/session", async (c) => {
  const person = sessionOf(c.req.header("Cookie"));
  return c.json({ keySignIn: keySignInAvailable(), signedIn: person !== null, ...(person ? { person: viewOf(person) } : {}) }, 200);
});

/**
 * Signing in and out are the page's own acts: a request that does not come from
 * this surface's page (a cross-site form, or a caller with no Origin at all, keyed
 * or not) is refused, so no other site can sign a browser in as someone else.
 */
function fromOwnPage(c: Context): boolean {
  const origin = c.req.header("Origin");
  return origin !== undefined && isOwnOrigin(origin, c.req.url);
}

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
  const { cookie } = openSession(result.session, Date.now(), cookieSecure(c));
  recordObservation({ type: "person_session", caller: callerOf(admittedCaller(c)), visibility: "operator_only", body: { event: "signed_in", user_id: result.session.userId, with: "key" } });
  return c.json({ signedIn: true, person: viewOf(result.session) }, 200, { "Set-Cookie": cookie });
});

proxyRouter.post("/api/session/logout", requireCaller("/api/session/logout"), (c) => {
  if (!fromOwnPage(c)) return c.json({ error: "sign-out is accepted only from this surface's page" }, 403);
  const person = sessionOf(c.req.header("Cookie"));
  const cleared = closeSession(c.req.header("Cookie"), cookieSecure(c));
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
  const answer = await readViaDiscovery({ type: "substrateGap", category: "ui_legibility", limit: 40 }, getRenderPolicy().timeouts.issuesMs);
  if (answer && Array.isArray(answer["gaps"])) return c.json({ gaps: answer["gaps"] }, 200, corsHeaders(c.req.header("Origin")));

  return c.json(
    { gaps: [], error: "no vessel serving substrateGap answered" },
    502,
    corsHeaders(c.req.header("Origin")),
  );
});

/**
 * One gap by id, from whichever vessel serves `substrateGap`: `{found, gap}`,
 * or null when no vessel serving it answered.
 */
export async function readGapById(id: string): Promise<{ found: boolean; gap: unknown } | null> {
  const answer = await readViaDiscovery({ type: "substrateGap", id, limit: 1 }, getRenderPolicy().timeouts.gapStatusMs);
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
    .filter((id) => !gapStatusInFlight.has(id) && now - (gapStatuses.get(id)?.at ?? 0) > getRenderPolicy().recheck.gapStatusTtlMs)
    .slice(0, getRenderPolicy().limits.gapStatusPerRead);
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
  await Promise.all(Array.from({ length: Math.min(getRenderPolicy().limits.gapStatusConcurrency, due.length) }, worker));
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

// ─── exposure record (browser write) ────────────────────────────────────────

/**
 * What the surface actually PUT ON SCREEN, and what the person then did with it.
 *
 * The endpoint `ui/src/api/exposure.ts` posts to, wired here rather than left a
 * 404: the record was already produced by the browser and dropped on the floor,
 * and a learner with no evidence source can only confirm its own ranking.
 *
 * It self-posts the `interactorObservation` SHAPE, so a record from the browser travels the same single
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
  if (!(VIEW_REGIONS as readonly string[]).includes(region)) return c.json({ error: "unknown_region" }, 404);
  return c.json(unnamePeople(currentView(region as ViewRegion), sessionOf(c.req.header("Cookie"))?.userId ?? null), 200, corsHeaders(c.req.header("Origin")));
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
 * cannot always dial. Calling the parser directly keeps the key server-side by
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
    { grammar: GRAMMAR, recent: unnamePeople(recentSurfaceIntents(20), sessionOf(c.req.header("Cookie"))?.userId ?? null) },
    200,
    corsHeaders(c.req.header("Origin")),
  ),
);

// ─── calibration (blind grading of a declared sample) ────────────────────────

export { corsHeaders };
export default proxyRouter;
