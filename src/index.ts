import { buildUiView } from "./ui-view.js";
import { getRenderPolicy } from "./store.js";
/**
 * human-surface-vessel — the substrate's human surface.
 *
 * Replaces stateful-ui-vessel and INHERITS its shape vocabulary: retiring a
 * vessel must not retire the vocabulary it served.
 *
 * Port 8310 (its own — 8290 belongs to the obsidian-vessel resolver bridge).
 *
 * Responsibilities:
 *   - serve the seven inherited shapes at /v2/impulses/resolve
 *   - proxy the browser to goal-host and discovery, injecting auth server-side
 *     (see routes/proxy.ts — that file is a security boundary)
 *   - serve the built UI from ../ui/dist
 *   - register flat with discovery, re-registering as its own heartbeat
 */

import { Hono } from "hono";
import {
  DISCOVERY_SHAPES,
  HOST,
  PORT,
  VESSEL_ID,
  VESSEL_NAME,
  config,
} from "./config.js";
import {
  deregisterFromDiscovery,
  discoveryStatus,
  startDiscoveryRegistration,
} from "./discovery-registration.js";
import { impulsesRouter } from "./routes/impulses.js";
import { corsHeaders, proxyRouter } from "./routes/proxy.js";
import {
  counts,
  listPanels,
  recentAsserts,
  recentAttachments,
  recentEvents,
  recentFeedback,
  recentObservations,
  signatureInputs,
  subscribe,
} from "./store.js";

const app = new Hono();

// ─── Liveness ───────────────────────────────────────────────────────────────

/**
 * Health reports discovery state for legibility but NEVER fails on it. This
 * vessel serves its shapes and its UI whether or not discovery is answering;
 * a health check that goes red on a peer outage causes restarts that fix
 * nothing.
 */
app.get("/health", (c) =>
  c.json({
    status: "ok",
    vessel: VESSEL_ID,
    name: VESSEL_NAME,
    port: PORT,
    shapes: DISCOVERY_SHAPES,
    store: counts(),
    discovery: discoveryStatus(),
  }),
);

app.get("/shapes", (c) => c.json({ shapes: DISCOVERY_SHAPES }));

// ─── Routers ────────────────────────────────────────────────────────────────

app.route("/", impulsesRouter);
app.route("/", proxyRouter);

// ─── Local read surface for the UI ──────────────────────────────────────────

app.get("/api/state", (c) =>
  c.json({
    panels: listPanels(),
    feedback: recentFeedback(20),
    observations: recentObservations(20),
    events: recentEvents(50),
    asserts: recentAsserts(30),
    attachments: recentAttachments(30),
  }),
);

app.get("/api/signature-inputs", (c) => c.json(signatureInputs()));

/** Server-sent events so the surface updates without polling. */
app.get("/api/stream", (c) => {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: { event: string; data: unknown }): void => {
        const payload = `event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`;
        try {
          controller.enqueue(encoder.encode(payload));
        } catch {
          /* closed */
        }
      };
      send({ event: "hello", data: { vesselId: VESSEL_ID, ts: Date.now() } });
      const unsubscribe = subscribe(send);
      const keepalive = setInterval(() => send({ event: "ping", data: Date.now() }), 25_000);
      const onClose = (): void => {
        clearInterval(keepalive);
        unsubscribe();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      c.req.raw.signal.addEventListener("abort", onClose);
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      ...corsHeaders(c.req.header("Origin")),
    },
  });
});

// ─── Static UI ──────────────────────────────────────────────────────────────

/**
 * Resolved from the module's own location, never the process CWD — a systemd
 * unit's working directory is not guaranteed to be the repo root.
 */
const UI_DIST = new URL("../ui/dist/", import.meta.url).pathname;

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

function contentTypeFor(path: string): string {
  const dot = path.lastIndexOf(".");
  if (dot < 0) return "application/octet-stream";
  return CONTENT_TYPES[path.slice(dot).toLowerCase()] ?? "application/octet-stream";
}

/** Never a blank page: an unbuilt UI says so, with the fix. */
function uiNotBuilt(): Response {
  return new Response(
    JSON.stringify({
      error: "ui_not_built",
      message:
        "The human-surface-vessel UI has not been built. Expected a bundle at " +
        "repos/human-surface-vessel/ui/dist. Build the UI, then reload — the " +
        "vessel's shape and proxy surfaces are unaffected and still serving.",
      expected_dir: UI_DIST,
      vessel: VESSEL_ID,
    }),
    { status: 503, headers: { "Content-Type": "application/json" } },
  );
}

async function serveUiFile(pathname: string): Promise<Response> {
  // Traversal is rejected before any join, not sanitized after.
  if (pathname.includes("..") || pathname.includes("\0")) {
    return new Response(JSON.stringify({ error: "invalid path" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const rel = pathname === "/" || pathname === "" ? "index.html" : pathname.replace(/^\/+/, "");
  const indexFile = Bun.file(`${UI_DIST}index.html`);
  if (!(await indexFile.exists())) return uiNotBuilt();

  const file = Bun.file(`${UI_DIST}${rel}`);
  if (await file.exists()) {
    return new Response(file, { headers: { "Content-Type": contentTypeFor(rel) } });
  }

  // SPA fallback: unknown non-asset paths render the app shell.
  if (!rel.includes(".")) {
    return new Response(indexFile, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  return new Response(JSON.stringify({ error: "not found", path: rel }), {
    status: 404,
    headers: { "Content-Type": "application/json" },
  });
}

app.get("/", () => serveUiFile("/"));

// Static assets and SPA routes. Registered last so it never shadows /health,
// /shapes, /api/*, or the resolver path.
app.get("*", async (c) => {
  const { pathname } = new URL(c.req.url);
  if (pathname.startsWith("/api/") || pathname.startsWith("/v2/")) {
    return c.json({ error: "not found", path: pathname }, 404);
  }
  return serveUiFile(pathname);
});

// ─── Start ──────────────────────────────────────────────────────────────────

/**
 * `/resolve` — the path the substrate's own `ui_legibility_scan` calls.
 *
 * The detector was written against obsidian-vessel and hardcodes `/resolve`
 * (the fleet's other convention is `/v2/impulses/resolve`). Serving both means
 * an existing, independent, effect-reading validator can audit this surface
 * with no change to the validator. That is cheaper and more trustworthy than
 * writing a second validator that would share an author with the thing it
 * checks.
 */
app.post("/resolve", async (c) => {
  const body = (await c.req.json().catch(() => null)) as null | Record<string, any>;
  const pointer = body?.["impulse"]?.["pointer"] ?? body?.["pointer"] ?? {};
  const type = pointer?.["type"];

  if (type === "obsidian:ui_view") {
    // `.content` as a JSON STRING is the detector's expected envelope.
    return c.json({ content: JSON.stringify(buildUiView(getRenderPolicy().tokenOverrides)), metadata: { shape: "obsidian:ui_view" } });
  }
  if (type === "obsidian:note") {
    // No theme-override note on this surface: tokens are the single source and
    // there is no vault file overriding them. Empty is the honest answer, and
    // it is why rule R2 finds nothing here rather than being skipped.
    return c.json({ content: "", metadata: { shape: "obsidian:note", path: pointer?.["path"] ?? null } });
  }
  return c.json({ error: `unsupported pointer '${String(type)}' on /resolve` }, 400);
});

const server = Bun.serve({
  port: PORT,
  hostname: HOST,
  fetch: app.fetch,
});

console.log(
  `[human-surface-vessel] listening on ${HOST}:${PORT} | discovery=${config.DISCOVERY_ENDPOINT} | shapes=${DISCOVERY_SHAPES.length}`,
);

// Fire-and-forget: a discovery outage must not block or fail startup.
startDiscoveryRegistration();

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[human-surface-vessel] ${signal} — deregistering`);
  await deregisterFromDiscovery();
  try {
    await server.stop();
  } catch {
    /* already stopped */
  }
  process.exit(0);
}

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

// NOT a default export: Bun auto-serves a default-exported Hono app as a server
// config, which collides with the explicit Bun.serve above and dies EADDRINUSE
// against its own listener. Named export only.
export { app };
