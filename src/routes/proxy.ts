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

/**
 * This substrate's own federation transport — the ingress that holds the relay
 * circuit and proxies a shape to the vessel that owns it on a peer substrate.
 *
 * It is how a `protocol: "libp2p"` discovery row is actually reached; see
 * `candidateEndpointsFor`. The transport serves the same
 * `/v2/impulses/resolve` contract as a local vessel, so nothing else in this
 * file needs to know whether a shape came from here or over HTTP.
 *
 * `??` alone is not enough: these env vars are GENERATED, and a generated file
 * routinely sets a key to the EMPTY STRING. `??` only replaces null/undefined,
 * so an empty value would sail through and every libp2p candidate would become
 * `""` — a fetch that throws instantly and silently drops the p2p path. Treat
 * blank as unset.
 */
function envOr(name: string, fallback: string): string {
  const raw = process.env[name];
  return typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : fallback;
}

const FEDERATION_INGRESS = envOr(
  "FEDERATION_TRANSPORT_ENDPOINT",
  `http://127.0.0.1:${envOr("FED_HEALTH_PORT", "8401")}`,
).replace(/\/+$/, "");

const GOAL_HOST_CACHE_TTL_MS = 30_000;
/** Short on purpose: this runs per candidate, so a dead one must not stall the page. */
const GOAL_HOST_PROBE_TIMEOUT_MS = 5_000;
let cachedGoalHost: { endpoint: GoalHostCandidate; at: number } | null = null;

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
    // The rewrite host is whichever registry ANSWERED. That is now always this
    // vessel's own discovery, so on a spoke it is loopback and the guard below
    // returns the record untouched — correct, because a row this registry hands
    // back is either genuinely in-container or already a transport address.
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
 * Where goal shapes are RESOLVED: this vessel's own discovery, always.
 *
 * This vessel is configured the way every vessel is — a discovery endpoint and a
 * credential — and it resolves every shape through that discovery. Discovery is
 * the fixed point; reaching past it to a second registry is a second routing
 * policy compiled into a consumer, which is exactly what the registry exists to
 * make unnecessary.
 *
 * This used to prefer `HUB_DISCOVERY_URL` when set, on the reasoning that "the
 * spoke's own registry hands back federation-transport addresses, while the hub's
 * registry hands back the hub's own goal-host, which is the one a spoke can
 * actually reach over HTTP." The second half of that is false, and measurably so:
 * the hub serves goal-host over libp2p ONLY — `syzygy.host:18210` answers HTTP 000
 * from the host and from inside the container alike. So the preferred path
 * resolved a row that cannot be dialled, `reachableFrom` rewrote its host while
 * keeping the in-container port, and the browser got a 502 from an address that
 * never existed. The address the local registry hands back — the federation
 * transport's ingress, which holds the relay circuit — is the one that works:
 * verified 200, tagged "proxied to the owning vessel on the peer substrate over
 * libp2p", both through the transport directly and through local discovery.
 *
 * What the local registry hands back is NOT fixed, and both answers are correct.
 * On a UI-only spoke it is the federation transport's ingress (a libp2p row). On
 * a compute spoke it is that substrate's OWN goal-host, registered locally —
 * measured on substrate-live: `goal-host-vessel`, protocol null,
 * http://127.0.0.1:8210, healthy. Resolving through discovery is what makes both
 * cases work without the caller knowing which one it is in, which is the point.
 *
 * Registration was never the thing in question and is unchanged: it stays local,
 * because registering on the hub publishes this container's private :8310 as a
 * network-wide record nobody outside the container can dial — measured: doing it
 * put exactly that record second in line for every hub-side consumer of
 * `surfaceIntent`.
 */
function goalShapeResolutionEndpoint(): string {
  return DISCOVERY_ENDPOINT.replace(/\/+$/, "");
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
  /**
   * True when this is our own federation ingress standing in for a libp2p row.
   * That ingress serves shape RESOLUTION only — measured, its router matches
   * exactly `/health`, `/egress/resolve` and `/v2/impulses/resolve` — so it can
   * answer the board's reads and cannot accept `/run-goal` or `/executions/:id`.
   */
  readonly resolveOnly: boolean;
}

/** The path an ordinary HTTP vessel serves when its row says nothing. */
const DEFAULT_RESOLVE_PATH = "/resolve";

function resolveUrl(cand: GoalHostCandidate): string {
  return `${cand.base}${cand.resolvePath}`;
}

/**
 * Does this address actually serve goal shapes, at the path IT advertises?
 *
 * ★ THE PATH IS PART OF THE ADDRESS. This probe used to hardcode `/resolve`,
 * and against a federation ingress that is a 404 — the ingress serves
 * `/v2/impulses/resolve`, which is exactly what its own discovery row says in
 * `resolve_endpoint`. So the surface fetched a row carrying the right path,
 * ignored the field, asked for a path that does not exist, and rejected its one
 * working candidate: `1 vessel(s) advertise goal_execution; none answered a
 * resolve call`, then a 502 on every board read.
 *
 * ★ A 404 FROM A FEDERATION INGRESS IS INDISTINGUISHABLE FROM A DEAD RELAY.
 * At the moment of that 404 the transport journal was cycling
 * `reservation lost → phantom-reservation suspicion → circuit=(pending)` every
 * ten minutes, so "the relay is down" was the obvious reading and would have
 * sent anyone debugging this to the hub. It was wrong. Measured on the wire,
 * same port, same second: `/resolve` → 404, `/v2/impulses/resolve` → 200 in
 * about a second, carrying a real proxied answer tagged
 * `produced_by: goal-host-vessel@federation-transport-vessel@spoke-cfda39e7`.
 * The circuit was carrying traffic while the log said pending. A 404 is the
 * router declining a path, not the network failing to deliver — before blaming
 * transport for one, enumerate the paths that vessel actually serves.
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
async function servesGoalShapes(cand: GoalHostCandidate): Promise<boolean> {
  try {
    const res = await fetch(resolveUrl(cand), {
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
async function candidateEndpointsFor(shape: string): Promise<readonly GoalHostCandidate[]> {
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
      content?: {
        vessels?: Array<{
          endpoint?: unknown;
          public_endpoint?: unknown;
          protocol?: unknown;
          /** The path this producer serves resolves on; see `pathOf` below. */
          resolve_endpoint?: unknown;
        }>;
      };
    };
    const vessels = Array.isArray(j?.content?.vessels) ? j.content.vessels : [];
    const p2p: GoalHostCandidate[] = [];
    const http: GoalHostCandidate[] = [];
    // A row's own advertised path, normalised. Absent, blank, or non-string all
    // mean "the ordinary one" — an HTTP vessel that says nothing keeps working
    // exactly as before, which is what makes reading the field safe to add.
    const pathOf = (raw: unknown): string => {
      if (typeof raw !== "string") return DEFAULT_RESOLVE_PATH;
      const t = raw.trim();
      if (t.length === 0) return DEFAULT_RESOLVE_PATH;
      return t.startsWith("/") ? t.replace(/\/+$/, "") : `/${t.replace(/\/+$/, "")}`;
    };
    for (const v of vessels) {
      // A libp2p row is NOT an HTTP address, and rewriting it into one invents
      // an endpoint that cannot exist.
      //
      // `reachableFrom` rests on "whatever host answered discovery also
      // publishes this fleet's mapped ports". That holds for an HTTP vessel and
      // is false for a federation re-export: measured, `syzygy.host:18401` has
      // no route while `:18100` on the same host answers 200. So the rewrite
      // produced an address that HANGS for the caller's full timeout — and
      // because the lookup "succeeded", the caller burned its whole budget on it
      // and never reached its own error path. That is the failure this branch
      // exists to prevent.
      //
      // The reachable form of a libp2p row is OUR OWN transport's ingress: it
      // holds the relay circuit and proxies to the owning vessel on the peer
      // substrate. Verified on the wire — the same ask that hung for 12s against
      // the rewritten address returns 200 in ~1.5s here, tagged
      // "proxied to the owning vessel on the peer substrate over libp2p".
      //
      // The ingress's path comes from the ROW, not from us. The transport
      // registers `resolve_endpoint: "/v2/impulses/resolve"` precisely so a
      // caller does not have to know; the default below is the same value and
      // exists only for a row that omits the field.
      if (v?.protocol === "libp2p") {
        if (FEDERATION_INGRESS) {
          p2p.push({
            base: FEDERATION_INGRESS,
            resolvePath: pathOf(
              typeof v?.resolve_endpoint === "string" && v.resolve_endpoint.trim().length > 0
                ? v.resolve_endpoint
                : "/v2/impulses/resolve",
            ),
            resolveOnly: true,
          });
        }
        continue;
      }
      const candidate = reachableFrom(
        typeof v?.public_endpoint === "string" && v.public_endpoint.length > 0
          ? v.public_endpoint
          : typeof v?.endpoint === "string"
            ? v.endpoint
            : undefined,
        resolvedAt,
      );
      if (typeof candidate === "string" && candidate.length > 0) {
        http.push({
          base: candidate.replace(/\/+$/, ""),
          resolvePath: pathOf(v?.resolve_endpoint),
          resolveOnly: false,
        });
      }
    }
    // p2p FIRST, http as the fallback. One ingress entry however many libp2p
    // rows advertise the shape: they all reach the same local transport, so
    // repeating it only multiplies the timeout when the circuit is down.
    //
    // Dedupe on base+path now that a candidate is a pair: the same address at
    // two different paths is two different call sites, not a repeat.
    const seen = new Set<string>();
    const out: GoalHostCandidate[] = [];
    for (const cand of [...p2p, ...http]) {
      const key = resolveUrl(cand);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(cand);
    }
    return out;
  } catch (err) {
    console.warn(
      `[human-surface] discovery lookup for ${shape} failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return [];
  }
}

async function resolveGoalHostEndpoint(): Promise<GoalHostCandidate> {
  const now = Date.now();
  if (cachedGoalHost && now - cachedGoalHost.at < GOAL_HOST_CACHE_TTL_MS) {
    return cachedGoalHost.endpoint;
  }
  if (process.env["GOAL_HOST_ENDPOINT"]) {
    const pinned: GoalHostCandidate = {
      base: process.env["GOAL_HOST_ENDPOINT"].replace(/\/+$/, ""),
      resolvePath: DEFAULT_RESOLVE_PATH,
      resolveOnly: false,
    };
    cachedGoalHost = { endpoint: pinned, at: now };
    return pinned;
  }
  const candidates = await candidateEndpointsFor("goal_execution");
  for (const cand of candidates) {
    if (await servesGoalShapes(cand)) {
      cachedGoalHost = { endpoint: cand, at: now };
      return cand;
    }
  }
  if (candidates.length > 0) {
    console.warn(
      `[human-surface] ${candidates.length} vessel(s) advertise goal_execution; none answered a resolve call`,
    );
  }
  // NOT CACHED. A fallback is what happens when resolution FAILED, and caching
  // it treats a failure like an answer: one transient registry miss — a vessel
  // mid-re-registration, a restart, a dropped packet — became thirty seconds of
  // hard 502 for every request, because each one returned the cached bad
  // address instantly without ever retrying discovery. Measured: fourteen
  // goals dispatched in about two seconds, all failing, from a single blip that
  // had already cleared. Resolution is cheap and this path is rare; re-resolve.
  return {
    base: GOAL_HOST_ENDPOINT.replace(/\/+$/, ""),
    resolvePath: DEFAULT_RESOLVE_PATH,
    resolveOnly: false,
  };
}

/**
 * A goal host that can accept a DISPATCH, not merely answer a resolve.
 *
 * These are not the same capability and conflating them is how a clear failure
 * becomes a mystery. The federation ingress proxies shape resolution over the
 * relay circuit and serves nothing else — no `/run-goal`, no `/executions/:id`
 * — so a spoke whose only `goal_execution` producer is a federated row can read
 * the board perfectly and still have nowhere to send a goal. Measured on
 * substrate-ui: its local registry's one producer is a libp2p row for a peer
 * spoke, and the hub's own goal-host has no HTTP plane from here at all
 * (`syzygy.host:18210`, `connect=0.000000` — the connection was never made).
 *
 * So: prefer the resolved candidate when it can actually take a dispatch, else
 * the first HTTP candidate, else say so. Returning the resolve-only ingress
 * here would produce a 404 from an address that is working correctly, which
 * reads as a broken transport and is not one.
 */
async function resolveGoalDispatchEndpoint(): Promise<GoalHostCandidate | null> {
  const primary = await resolveGoalHostEndpoint();
  if (!primary.resolveOnly) return primary;
  for (const cand of await candidateEndpointsFor("goal_execution")) {
    if (!cand.resolveOnly) return cand;
  }
  return null;
}

/** The 502 a dispatch gets when nothing reachable can accept one. */
function noDispatchHost(origin: string | undefined): Response {
  return new Response(
    JSON.stringify({
      error: "no goal host can accept a dispatch",
      detail:
        "Shape resolution works — the board can be read. Every producer of " +
        "goal_execution reachable from here is a federated row, and the " +
        "federation ingress proxies resolve calls only; it serves no /run-goal. " +
        "This substrate needs a goal host reachable over HTTP.",
    }),
    { status: 502, headers: { "Content-Type": "application/json", ...corsHeaders(origin) } },
  );
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
  const cand = await resolveGoalDispatchEndpoint();
  if (!cand) return noDispatchHost(c.req.header("Origin"));
  return passthrough({
    url: `${cand.base}/run-goal`,
    method: "POST",
    rawBody: await rawBodyOf(c),
    origin: c.req.header("Origin"),
  });
});

proxyRouter.post("/api/resolve", async (c) => {
  // The candidate's OWN path. This is the line that was `${base}/resolve`.
  const cand = await resolveGoalHostEndpoint();
  return passthrough({
    url: resolveUrl(cand),
    method: "POST",
    rawBody: await rawBodyOf(c),
    origin: c.req.header("Origin"),
  });
});

proxyRouter.get("/api/executions/:dispatchId", async (c) => {
  const dispatchId = c.req.param("dispatchId");
  const cand = await resolveGoalDispatchEndpoint();
  if (!cand) return noDispatchHost(c.req.header("Origin"));
  return passthrough({
    url: `${cand.base}/executions/${encodeURIComponent(dispatchId)}`,
    method: "GET",
    origin: c.req.header("Origin"),
  });
});

// ─── discovery ──────────────────────────────────────────────────────────────

/**
 * THE SHAPE VOCABULARY IS THE UNION OF TWO REGISTRIES, AND HAS TO BE.
 *
 * This route used to forward to the local registry alone, which quietly made
 * the surface's starter suggestions a list of its own plumbing. Measured on
 * this spoke: local advertises 16 shapes — `interactorEvent`, `llmQuotaState`,
 * `renderPolicy` and the like — while the hub advertises 156. The comment in
 * `ui/src/lib/starters.ts` says starters derive from the live vocabulary
 * precisely so a fixed list cannot go stale; deriving them from the wrong
 * registry defeats that just as thoroughly as hardcoding would, and less
 * visibly, because the list still moves.
 *
 * It is a UNION rather than a switch to the hub, and the reason is durability
 * rather than present necessity. Measured today: the local 16 are a strict
 * SUBSET of the hub's 156, so a hub-only read would lose nothing right now.
 * But the subset relation is a fact about the current fleet, not a guarantee —
 * this vessel registers locally by design, so its own shapes are present on the
 * hub only for as long as some hub-side peer keeps advertising them. A union
 * cannot regress when that stops being true, and it degrades the right way when
 * the hub is unreachable: local shapes still answer, and `registries` records
 * that the fleet leg went unread.
 *
 * Fail-soft per registry, and SAY WHICH ANSWERED. If the hub is unreachable the
 * reader still gets local shapes rather than an error, but `registries` records
 * that the fleet leg was not read — otherwise a 16-shape answer is
 * indistinguishable from a healthy one, which is the same trap as reading an
 * empty gap list as "no gaps".
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

proxyRouter.get("/api/discovery/shapes", async (c) => {
  const local = DISCOVERY_ENDPOINT.replace(/\/+$/, "");
  const fleet = goalShapeResolutionEndpoint();

  // On an unfederated substrate both resolve to the same base; read it once.
  const legs: Array<{ name: string; base: string }> =
    fleet === local
      ? [{ name: "local", base: local }]
      : [
          { name: "local", base: local },
          { name: "fleet", base: fleet },
        ];

  const answers = await Promise.all(legs.map((leg) => readShapesFrom(leg.base)));

  const union = new Set<string>();
  const registries = legs.map((leg, i) => {
    const shapes = answers[i];
    if (shapes) for (const s of shapes) union.add(s);
    return { registry: leg.name, ok: shapes !== null, count: shapes?.length ?? 0 };
  });

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
 * Capability lookups must ask the registry that ADVERTISED the shape.
 *
 * This is the other half of the union above, and skipping it would have made
 * the surface less honest rather than more useful. Chips are derived from the
 * union but verified here; pointed at the local registry alone, every
 * hub-derived chip resolves to zero producers, renders dashed, and claims in
 * its tooltip that "discovery confirmed no live producer" — a confident false
 * negative on essentially every chip on screen, laundered through the exact
 * three-state mechanism that exists to keep "unknown" from being reported as
 * "absent".
 *
 * ★ THE POINTER TYPE IS A SAFETY BOUNDARY, NOT A DETAIL. `POST /resolve` with
 * an ordinary shape EXECUTES that shape. A `vesselCapability` pointer asks who
 * could serve it and runs nothing. So the fan-out to the hub is allowed ONLY
 * for `vesselCapability`: anything else stays local, where this surface already
 * has a relationship, rather than becoming a way for a page to trigger work on
 * the hub through a route named "resolve".
 */
function isCapabilityPointer(rawBody: string): boolean {
  try {
    const parsed = JSON.parse(rawBody) as { pointer?: { type?: unknown } };
    return parsed?.pointer?.type === "vesselCapability";
  } catch {
    return false;
  }
}

/** A resolve attempt, buffered so the winning upstream's body can be replayed. */
async function tryResolve(
  base: string,
  rawBody: string,
): Promise<{ status: number; text: string; producers: number } | null> {
  try {
    const res = await fetch(`${base.replace(/\/+$/, "")}/resolve`, {
      method: "POST",
      headers: upstreamHeaders(true),
      body: rawBody,
      signal: AbortSignal.timeout(SHAPES_TIMEOUT_MS),
    });
    const text = await res.text();
    let producers = 0;
    try {
      const j = JSON.parse(text) as {
        content?: { vessels?: unknown };
        vessels?: unknown;
        producers?: unknown;
      };
      const list = j?.content?.vessels ?? j?.vessels ?? j?.producers;
      if (Array.isArray(list)) producers = list.length;
    } catch {
      /* non-JSON upstream — treat as zero producers, still replayable */
    }
    return { status: res.status, text, producers };
  } catch {
    return null;
  }
}

proxyRouter.post("/api/discovery/resolve", async (c) => {
  const rawBody = await rawBodyOf(c);
  const origin = c.req.header("Origin");
  const local = DISCOVERY_ENDPOINT.replace(/\/+$/, "");
  const fleet = goalShapeResolutionEndpoint();

  if (!isCapabilityPointer(rawBody) || fleet === local) {
    return passthrough({ url: `${local}/resolve`, method: "POST", rawBody, origin });
  }

  // Local first: it answers fastest and owns this vessel's own shapes. Only a
  // local answer with no producers is worth a second call.
  const localAnswer = await tryResolve(local, rawBody);
  if (localAnswer !== null && localAnswer.status === 200 && localAnswer.producers > 0) {
    return new Response(localAnswer.text, {
      status: localAnswer.status,
      headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
    });
  }

  const fleetAnswer = await tryResolve(fleet, rawBody);
  const winner =
    fleetAnswer !== null && fleetAnswer.status === 200 && fleetAnswer.producers > 0
      ? fleetAnswer
      : (localAnswer ?? fleetAnswer);

  if (winner === null) {
    return new Response(JSON.stringify({ error: "upstream unreachable" }), {
      status: 502,
      headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
    });
  }

  return new Response(winner.text, {
    status: winner.status,
    headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
  });
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
        // 4s, not 12s, and the number is load-bearing. This route tries every
        // candidate SEQUENTIALLY and then a pinned fallback, so its worst case is
        // the sum of these — which at 12s each exceeded the server's own
        // response tolerance. The connection was closed before the handler
        // returned, so the honest 502 below was UNREACHABLE and a browser saw a
        // network error instead of "no vessel serving substrateGap answered".
        // An error path that cannot execute is not a fallback. Keep the total
        // (candidates + pin) safely under `SERVER_IDLE_TIMEOUT_S`.
        signal: AbortSignal.timeout(4_000),
      });
      if (!upstream.ok) return null;
      const j = (await upstream.json()) as {
        body?: { gaps?: unknown[] };
        content?: { body?: { gaps?: unknown[] }; error?: unknown };
      };
      // The federation transport wraps the owning vessel's answer in `content`
      // and reports a dead circuit as `content.error` with HTTP 200 — so
      // `upstream.ok` says nothing about whether we got gaps. Unwrap both
      // shapes; anything else is "this candidate did not answer".
      const direct = j?.body?.gaps;
      if (Array.isArray(direct)) return direct;
      const proxied = j?.content?.body?.gaps;
      return Array.isArray(proxied) ? proxied : null;
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
  // This route asks at `/v2/impulses/resolve` and is left that way ON PURPOSE:
  // it is the impulse-resolve contract, which both development-vessel and the
  // federation ingress serve, and it is measured working. The candidate's
  // `resolvePath` describes the goal-shape `/resolve` contract, which is a
  // different call — substituting it here would break a route that works today
  // for the sake of symmetry.
  for (const cand of await candidateEndpointsFor("substrateGap")) {
    const gaps = await ask(cand.base);
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
