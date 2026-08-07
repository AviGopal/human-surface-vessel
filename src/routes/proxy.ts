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
import { getRenderPolicy, recentSurfaceIntents, recordSurfaceIntent, writeRenderPolicy } from "../store.js";
import { GRAMMAR, readSurfaceIntent } from "../surface-intent.js";
import {
  DISCOVERY_ENDPOINT,
  GOAL_HOST_ENDPOINT,
  METABOB_API_KEY,
  PORT,
  RESOLVE_PATH,
} from "../config.js";

/** The host maps container ports by convention 8xxx → 18xxx. */
const HOST_PORT_OFFSET = 10_000;

function allowedOrigin(requestOrigin: string | undefined): string {
  const self = `http://127.0.0.1:${PORT}`;
  if (!requestOrigin) return self;
  try {
    const u = new URL(requestOrigin);
    const p = parseInt(u.port || (u.protocol === "https:" ? "443" : "80"), 10);
    // This vessel's own origin, whether reached on the container port or the
    // conventionally mapped host port.
    if (p === PORT || p === PORT + HOST_PORT_OFFSET) return requestOrigin;
  } catch {
    /* malformed Origin — fall through */
  }
  return self;
}

function corsHeaders(requestOrigin: string | undefined): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": allowedOrigin(requestOrigin),
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

// ─── goal-host location (discovery by shape, short TTL cache) ───────────────

/**
 * activity-api is a BOOTSTRAP peer here, not a discovery lookup, and that is
 * deliberate: `goal_verification_label_write` is defined and tested in
 * activity-api but is NOT currently advertised in the live registry, so
 * resolving it by shape returns nothing. Going direct is the honest option;
 * a shape lookup would fail closed and silently swallow every human verdict.
 */
const ACTIVITY_API_ENDPOINT = (
  process.env["ACTIVITY_API_ENDPOINT"] ??
  process.env["ACTIVITY_API_URL"] ??
  "http://127.0.0.1:8080"
).replace(/\/+$/, "");

const GOAL_HOST_CACHE_TTL_MS = 30_000;
/** Short on purpose: this runs per candidate, so a dead one must not stall the page. */
const GOAL_HOST_PROBE_TIMEOUT_MS = 5_000;
let cachedGoalHost: { endpoint: string; at: number } | null = null;

/**
 * Never throws. Resolution order, and the order matters:
 *
 *   1. An EXPLICIT `GOAL_HOST_ENDPOINT` in the environment. An operator who
 *      names an address means it, and it must beat a registry guess.
 *   2. Discovery, by shape.
 *   3. The loopback literal.
 *
 * Why (1) outranks (2): vessels register their IN-CONTAINER address — goal-host
 * advertises `http://127.0.0.1:8210`. That is correct for a peer inside the same
 * container and unreachable for anyone else. A caller running outside it
 * resolves an address it cannot dial, and because the lookup SUCCEEDED the env
 * fallback never fires — a silent 502 with a healthy-looking registry.
 * obsidian-vessel's federation sidecar hits the same wall and solves it by
 * remapping loopback to the discovery host with the port offset; until this
 * vessel does the same, an explicit override is the escape hatch.
 */

const LOOPBACK = new Set(["127.0.0.1", "localhost", "0.0.0.0", "::1", "[::1]"]);

/**
 * Rewrite a loopback address into one this process can actually dial.
 *
 * Every vessel registers its IN-CONTAINER address, and `public_endpoint` only
 * changes the PORT (8210 -> 18210), not the host — both are 127.0.0.1. That is
 * correct for a peer inside that container and dead for anyone else, and
 * because the lookup SUCCEEDS the caller gets an address it cannot reach rather
 * than an error it can handle.
 *
 * The derivation is obsidian-vessel's federation sidecar's, and it is sound for
 * the same reason: whatever host we reach DISCOVERY on is a host that publishes
 * this fleet's mapped ports, so the discovery host plus the already-offset
 * public port is reachable by construction. Nothing is hardcoded — if discovery
 * itself is on loopback we are inside the container and the address was right
 * all along.
 */
function reachableFrom(raw: string | undefined, resolvedAt: string): string | undefined {
  if (!raw) return undefined;
  let target: URL;
  let disc: URL;
  try {
    target = new URL(raw);
    // The rewrite host is whichever registry ANSWERED, not whichever registry
    // this vessel registers with. On a federated spoke those are two different
    // machines: goal shapes are resolved on the hub while registration stays
    // local, so rewriting a hub record's loopback to the local discovery host
    // would produce an address on the wrong machine entirely.
    disc = new URL(resolvedAt);
  } catch {
    return raw;
  }
  if (!LOOPBACK.has(target.hostname)) return raw;
  if (LOOPBACK.has(disc.hostname)) return raw; // we are in-container; loopback is correct
  target.hostname = disc.hostname;
  return target.toString().replace(/\/+$/, "");
}

/**
 * Where goal shapes are RESOLVED, which is not necessarily where this vessel
 * REGISTERS.
 *
 * On a federated spoke those must differ. The spoke's own registry does import
 * the hub's vessels, but it hands back their federation-transport addresses; the
 * hub's registry hands back the hub's own goal-host as well, which is the one a
 * spoke can actually reach over HTTP. Registration has to stay local either way,
 * because registering on the hub publishes this container's private :8310 as a
 * network-wide record nobody outside the container can dial — measured: doing it
 * put exactly that record second in line for every hub-side consumer of
 * `surfaceIntent`.
 */
function goalShapeResolutionEndpoint(): string {
  const hub = process.env["HUB_DISCOVERY_URL"];
  return typeof hub === "string" && hub.trim().length > 0
    ? hub.trim().replace(/\/+$/, "")
    : DISCOVERY_ENDPOINT;
}

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
async function servesGoalShapes(base: string): Promise<boolean> {
  try {
    const res = await fetch(`${base}/resolve`, {
      method: "POST",
      headers: upstreamHeaders(true),
      body: JSON.stringify({ type: "activeDispatches" }),
      signal: AbortSignal.timeout(GOAL_HOST_PROBE_TIMEOUT_MS),
    });
    return res.status === 200;
  } catch {
    return false;
  }
}

/**
 * Every address advertising `shape`, in registry order, rewritten to something
 * this process can dial.
 *
 * EVERY candidate, not `vessels[0]`. A shape has as many producers as the
 * network has vessels serving it: the hub advertises three for `goal_execution`
 * — its own goal-host, plus a re-exported record per federated peer. Taking the
 * first and trusting it meant one undialable record at the front of that list
 * took the whole surface down with a 502 while two working producers sat behind
 * it. Preferring `public_endpoint` is still right, because it carries the
 * host-mapped port; it is a preference per candidate now rather than a decision
 * made once for all of them.
 */
async function candidateEndpointsFor(shape: string): Promise<readonly string[]> {
  const resolvedAt = goalShapeResolutionEndpoint();
  try {
    const res = await fetch(`${resolvedAt}/resolve`, {
      method: "POST",
      headers: upstreamHeaders(true),
      body: JSON.stringify({ pointer: { type: "vesselCapability", shape } }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return [];
    const j = (await res.json().catch(() => null)) as null | {
      content?: { vessels?: Array<{ endpoint?: unknown; public_endpoint?: unknown }> };
    };
    const vessels = Array.isArray(j?.content?.vessels) ? j.content.vessels : [];
    const out: string[] = [];
    for (const v of vessels) {
      const candidate = reachableFrom(
        typeof v?.public_endpoint === "string" && v.public_endpoint.length > 0
          ? v.public_endpoint
          : typeof v?.endpoint === "string"
            ? v.endpoint
            : undefined,
        resolvedAt,
      );
      if (typeof candidate === "string" && candidate.length > 0) {
        out.push(candidate.replace(/\/+$/, ""));
      }
    }
    return out;
  } catch (err) {
    console.warn(
      `[human-surface] discovery lookup for ${shape} failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return [];
  }
}

async function resolveGoalHostEndpoint(): Promise<string> {
  const now = Date.now();
  if (cachedGoalHost && now - cachedGoalHost.at < GOAL_HOST_CACHE_TTL_MS) {
    return cachedGoalHost.endpoint;
  }
  if (process.env["GOAL_HOST_ENDPOINT"]) {
    const pinned = process.env["GOAL_HOST_ENDPOINT"].replace(/\/+$/, "");
    cachedGoalHost = { endpoint: pinned, at: now };
    return pinned;
  }
  const candidates = await candidateEndpointsFor("goal_execution");
  for (const base of candidates) {
    if (await servesGoalShapes(base)) {
      cachedGoalHost = { endpoint: base, at: now };
      return base;
    }
  }
  if (candidates.length > 0) {
    console.warn(
      `[human-surface] ${candidates.length} vessel(s) advertise goal_execution; none answered a resolve call`,
    );
  }
  const fallback = GOAL_HOST_ENDPOINT.replace(/\/+$/, "");
  cachedGoalHost = { endpoint: fallback, at: now };
  return fallback;
}

// ─── passthrough ────────────────────────────────────────────────────────────

interface PassthroughOpts {
  url: string;
  method: "GET" | "POST";
  rawBody?: string;
  origin: string | undefined;
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
      headers: upstreamHeaders(method === "POST"),
      ...(method === "POST" ? { body: rawBody ?? "{}" } : {}),
    });
  } catch (err) {
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

proxyRouter.post("/api/run-goal", async (c) => {
  const base = await resolveGoalHostEndpoint();
  return passthrough({
    url: `${base}/run-goal`,
    method: "POST",
    rawBody: await rawBodyOf(c),
    origin: c.req.header("Origin"),
  });
});

proxyRouter.post("/api/resolve", async (c) => {
  const base = await resolveGoalHostEndpoint();
  return passthrough({
    url: `${base}/resolve`,
    method: "POST",
    rawBody: await rawBodyOf(c),
    origin: c.req.header("Origin"),
  });
});

proxyRouter.get("/api/executions/:dispatchId", async (c) => {
  const dispatchId = c.req.param("dispatchId");
  const base = await resolveGoalHostEndpoint();
  return passthrough({
    url: `${base}/executions/${encodeURIComponent(dispatchId)}`,
    method: "GET",
    origin: c.req.header("Origin"),
  });
});

// ─── discovery ──────────────────────────────────────────────────────────────

proxyRouter.post("/api/discovery/resolve", async (c) =>
  passthrough({
    url: `${DISCOVERY_ENDPOINT.replace(/\/+$/, "")}/resolve`,
    method: "POST",
    rawBody: await rawBodyOf(c),
    origin: c.req.header("Origin"),
  }),
);

// /registry/shapes is keyless upstream (discovery's auth middleware exempts it),
// but the key is injected anyway — harmless there, and one code path is one
// thing to get right.
proxyRouter.get("/api/discovery/shapes", async (c) =>
  passthrough({
    url: `${DISCOVERY_ENDPOINT.replace(/\/+$/, "")}/registry/shapes`,
    method: "GET",
    origin: c.req.header("Origin"),
  }),
);

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
proxyRouter.post("/api/grade", async (c) => {
  const body = (await c.req.json().catch(() => null)) as null | Record<string, unknown>;
  if (!body || typeof body["execution_id"] !== "string" || typeof body["verdict"] !== "string") {
    return c.json(
      { error: "execution_id and verdict are required" },
      400,
      corsHeaders(c.req.header("Origin")),
    );
  }
  return passthrough({
    url: `${ACTIVITY_API_ENDPOINT}/v2/impulses/resolve`,
    method: "POST",
    rawBody: JSON.stringify({
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
          notes: body["notes"] ?? null,
          labeler: "human",
        },
      },
    }),
    origin: c.req.header("Origin"),
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
  const body = JSON.stringify({
    impulse: { pointer: { type: "substrateGap", category: "ui_legibility", limit: 40 } },
  });
  const ask = async (base: string): Promise<unknown[] | null> => {
    try {
      const upstream = await fetch(`${base.replace(/\/+$/, "")}/v2/impulses/resolve`, {
        method: "POST",
        headers: upstreamHeaders(true),
        body,
        signal: AbortSignal.timeout(12_000),
      });
      if (!upstream.ok) return null;
      const j = (await upstream.json()) as { body?: { gaps?: unknown[] } };
      return Array.isArray(j?.body?.gaps) ? j.body.gaps : null;
    } catch {
      return null;
    }
  };

  // BY SHAPE, through discovery — the same path the goal shapes take.
  //
  // This used to read a single hardcoded loopback env, which is correct only
  // where a gap store happens to run in this container. On a UI-only spoke
  // nothing serves `substrateGap` locally, so the panel 502'd permanently and
  // the surface could not show a person what is known to be wrong with it —
  // on exactly the deployment whose whole job is to show a person things.
  // The env stays as a last resort so a lone substrate with no registry still
  // works.
  for (const base of await candidateEndpointsFor("substrateGap")) {
    const gaps = await ask(base);
    if (gaps) return c.json({ gaps }, 200, corsHeaders(c.req.header("Origin")));
  }
  const pinned = process.env["DEV_VESSEL_ENDPOINT"] ?? "http://127.0.0.1:8090";
  const gaps = await ask(pinned);
  if (gaps) return c.json({ gaps }, 200, corsHeaders(c.req.header("Origin")));

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
proxyRouter.post("/api/feedback", async (c) => {
  const body = (await c.req.json().catch(() => null)) as null | Record<string, unknown>;
  if (!body || typeof body["panel_id"] !== "string" || !body["value"]) {
    return c.json(
      { error: "panel_id and value are required" },
      400,
      corsHeaders(c.req.header("Origin")),
    );
  }
  return passthrough({
    url: `http://127.0.0.1:${PORT}${RESOLVE_PATH}`,
    method: "POST",
    rawBody: JSON.stringify({
      impulse: {
        pointer: {
          type: "uiFeedback",
          panel_id: body["panel_id"],
          value: body["value"],
          kind: "reaction",
          complaint_kind: body["kind"] ?? "wrong",
          visibility: "public",
        },
      },
    }),
    origin: c.req.header("Origin"),
  });
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
proxyRouter.post("/api/surface-intent", async (c) => {
  const origin = c.req.header("Origin");
  const body = (await c.req.json().catch(() => null)) as null | Record<string, unknown>;
  const raw = body?.["text"] ?? body?.["instruction"];
  const text = typeof raw === "string" ? raw : "";
  if (text.trim() === "") {
    return c.json(
      { applied: false, understood: false, error: "text required", grammar: GRAMMAR },
      400,
      corsHeaders(origin),
    );
  }

  const reading = readSurfaceIntent(text, getRenderPolicy());

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

  const next = writeRenderPolicy(reading.patch);
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

export { corsHeaders, resolveGoalHostEndpoint };
export default proxyRouter;
