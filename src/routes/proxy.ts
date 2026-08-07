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
import { getRenderPolicy } from "../store.js";
import {
  DISCOVERY_ENDPOINT,
  GOAL_HOST_ENDPOINT,
  METABOB_API_KEY,
  PORT,
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
  try {
    const res = await fetch(`${DISCOVERY_ENDPOINT}/resolve`, {
      method: "POST",
      headers: upstreamHeaders(true),
      body: JSON.stringify({
        pointer: { type: "vesselCapability", shape: "goal_execution" },
      }),
    });
    if (res.ok) {
      const j = (await res.json().catch(() => null)) as null | {
        content?: { vessels?: Array<{ endpoint?: unknown }> };
      };
      const first = j?.content?.vessels?.[0];
      const endpoint = first?.endpoint;
      if (typeof endpoint === "string" && endpoint.length > 0) {
        cachedGoalHost = { endpoint: endpoint.replace(/\/+$/, ""), at: now };
        return cachedGoalHost.endpoint;
      }
    }
  } catch (err) {
    console.warn(
      `[human-surface] goal-host discovery lookup failed: ${err instanceof Error ? err.message : String(err)}`,
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
          confidence: body["confidence"] ?? null,
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
  const dev = (
    process.env["DEV_VESSEL_ENDPOINT"] ?? "http://127.0.0.1:8090"
  ).replace(/\/+$/, "");
  try {
    const upstream = await fetch(`${dev}/v2/impulses/resolve`, {
      method: "POST",
      headers: upstreamHeaders(true),
      body: JSON.stringify({
        impulse: { pointer: { type: "substrateGap", category: "ui_legibility", limit: 40 } },
      }),
      signal: AbortSignal.timeout(12_000),
    });
    const j = (await upstream.json()) as { body?: { gaps?: unknown[] } };
    return c.json({ gaps: j?.body?.gaps ?? [] }, 200, corsHeaders(c.req.header("Origin")));
  } catch (err) {
    return c.json(
      { gaps: [], error: err instanceof Error ? err.message : String(err) },
      502,
      corsHeaders(c.req.header("Origin")),
    );
  }
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

export { corsHeaders, resolveGoalHostEndpoint };
export default proxyRouter;
