/**
 * FALSIFIER for the-human-surfaces-api-run-goal-route-has-no-inbound-auth-and-forwards-with-the-fleet-key-so-an-unauthenticated-caller-starts-a-walk,
 * widened by qa to every human-surface write route behind one seam (src/inbound-auth.ts).
 *
 * Through the whole app (index.ts), so refuseForeignOriginWrites runs first as it does live.
 * Identity is a real HTTP stub on 127.0.0.1 (port 0): it authenticates keys that start with
 * "valid-", answers keyId and scopes, and refuses the rest. Every other outbound call
 * (discovery and whatever it places) is recorded and answered here, so "reaches nothing"
 * is read off the record, not assumed.
 */
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { restoreNativeGlobals, testAuth } from "./setup.ts";

// First: in one process an earlier file may have left happy-dom or a fetch stub installed (test/setup.ts).
await restoreNativeGlobals();

const identity = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(req) {
    const body = (await req.json().catch(() => ({}))) as { impulse?: { pointer?: { apiKey?: string } } };
    const key = String(body.impulse?.pointer?.apiKey ?? "");
    if (key.startsWith("valid-operator-")) {
      return Response.json({ success: true, data: { authenticated: true, keyId: "op-key-1", scopes: ["read", "write", "operator:direct"] } });
    }
    if (key.startsWith("valid-")) {
      return Response.json({ success: true, data: { authenticated: true, keyId: "svc-key-1", scopes: ["read", "write"] } });
    }
    return Response.json({ success: false, error: "invalid" }, { status: 401 });
  },
});
const IDENTITY_UP = `http://127.0.0.1:${identity.port}`;
const IDENTITY_DOWN = "http://127.0.0.1:9";
afterAll(() => identity.stop(true));

const outbound: Array<{ url: string; body: Record<string, unknown> }> = [];
const realFetch = globalThis.fetch;
// Undo what this file leaves in the one process (test/setup.ts): its fetch stub.
afterAll(() => {
  globalThis.fetch = realFetch;
});
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.endsWith("/v1/auth/resolve")) return realFetch(input as never, init);
  let body: Record<string, unknown> = {};
  try { body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>; } catch { /* not JSON */ }
  // A call through discovery carries its pointer; record what was asked for.
  body = (body["pointer"] as Record<string, unknown> | undefined) ?? body;
  outbound.push({ url, body });
  const type = String(body["type"] ?? (body["pointer"] as { type?: unknown } | undefined)?.type ?? "");
  if (type === "vesselCapability") return new Response(JSON.stringify({ content: { vessels: [] } }), { status: 200 });
  return new Response(JSON.stringify({ resolved: true, success: true, body: {} }), { status: 200 });
}) as typeof fetch;

const { app } = await import("../src/index.ts");
const { listPanels } = await import("../src/store.ts");
const { PORT } = await import("../src/config.ts");

const HERE = `http://127.0.0.1:${PORT}`;
const json = { "content-type": "application/json" };

/** Every write route and a body it accepts once a caller is admitted. */
const WRITES: ReadonlyArray<{ route: string; body: Record<string, unknown> }> = [
  ...["uiPanel_write", "uiQuestion_write", "human_input", "uiFeedback", "interactorObservation", "interactorEvent",
    "interactorAssertion", "interactorAttachment", "renderPolicy_write", "surfaceIntent"].map((type) => ({
    route: "/v2/impulses/resolve",
    body: { pointer: { type, id: `w-${type}`, title: "t", body: "b", solicitation_id: "s-1", panel_id: "p-1", response_id: "r-1", value: "v", obs_type: "click", event_type: "click", text: "bigger text", pointer: { type: "x" } } },
  })),
  { route: "/api/participation", body: { panel_id: "p-1", panel_revision: 1, response_id: "r-2", kind: "answer", value: "yes" } },
  { route: "/api/discovery/resolve", body: { pointer: { type: "vesselCapability", shape: "x" } } },
  { route: "/api/observations", body: { obs_type: "click", panel_id: "p-1" } },
  { route: "/api/surface-intent", body: { text: "make the text bigger" } },
  { route: "/api/page-frame", body: { source: "<p>x</p>" } },
];

const post = (route: string, body: unknown, headers: Record<string, string> = {}) =>
  app.request(`${HERE}${route}`, { method: "POST", headers: { ...json, ...headers }, body: JSON.stringify(body) });

beforeEach(() => {
  process.env.IDENTITY_VESSEL_URL = IDENTITY_UP;
  outbound.length = 0;
});

/** The refusal count /health reports for a reason and caller hint (0 before the seam existed). */
async function refusedCount(reason: string, hint: string): Promise<number> {
  const health = (await (await app.request(`${HERE}/health`)).json()) as { inbound_auth?: { refused?: Record<string, Record<string, number>> } };
  return health.inbound_auth?.refused?.[reason]?.[hint] ?? 0;
}

describe("every write route names its caller", () => {
  test("must-fail: a keyless no-Origin write to each write route is refused, keyless_not_allowlisted, and reaches nothing", async () => {
    const panelsBefore = listPanels().length;
    const countedBefore = await refusedCount("keyless_not_allowlisted", "keyless");
    for (const w of WRITES) {
      const r = await post(w.route, w.body);
      const j = (await r.json()) as { success?: boolean; error?: string; reason?: string };
      expect({ route: w.route, type: (w.body["pointer"] as { type?: string } | undefined)?.type, status: r.status }).toMatchObject({ status: 401 });
      expect(j.reason).toBe("keyless_not_allowlisted");
      expect(j.success).toBe(false);
      expect(String(j.error)).toStartWith("caller_credential_required: ");
    }
    expect(outbound).toEqual([]);
    expect(listPanels().length).toBe(panelsBefore);
    expect(await refusedCount("keyless_not_allowlisted", "keyless")).toBe(countedBefore + WRITES.length);
  });

  test("must-fail: a keyless foreign-Origin write is refused by the first gate", async () => {
    const r = await post("/api/participation", WRITES.find((w) => w.route === "/api/participation")!.body, { Origin: "http://evil.example" });
    expect(r.status).toBe(403);
    expect(outbound).toEqual([]);
  });

  test("must-fail: a keyless same-origin write is refused on a route the page does not use", async () => {
    const r = await post("/v2/impulses/resolve", { pointer: { type: "uiPanel_write", id: "same-origin-panel", title: "t", body: "b" } }, { Origin: HERE });
    expect(r.status).toBe(401);
    expect(((await r.json()) as { reason?: string }).reason).toBe("keyless_not_allowlisted");
    expect(listPanels().some((p) => p.id === "same-origin-panel")).toBe(false);
  });

  test("must-fail: an invalid key is refused key_rejected", async () => {
    const r = await post("/v2/impulses/resolve", { pointer: { type: "uiPanel_write", id: "bad-key-panel", title: "t", body: "b" } }, { Authorization: "ApiKey not-a-real-key" });
    expect(r.status).toBe(401);
    expect(((await r.json()) as { reason?: string }).reason).toBe("key_rejected");
    expect(listPanels().some((p) => p.id === "bad-key-panel")).toBe(false);
  });

  test("must-fail: identity unreachable refuses every other key, identity_unreachable", async () => {
    process.env.IDENTITY_VESSEL_URL = IDENTITY_DOWN;
    const r = await post("/v2/impulses/resolve", { pointer: { type: "uiPanel_write", id: "outage-panel", title: "t", body: "b" } }, { Authorization: "ApiKey valid-during-outage-1" });
    expect(r.status).toBe(401);
    const j = (await r.json()) as { reason?: string; error?: string };
    expect(j.reason).toBe("identity_unreachable");
    expect(outbound).toEqual([]);
  });

  test("must-fail: this vessel's own key is admitted during an identity outage", async () => {
    process.env.IDENTITY_VESSEL_URL = IDENTITY_DOWN;
    const r = await post("/v2/impulses/resolve", { pointer: { type: "uiPanel_write", id: "own-key-panel", title: "t", body: "b" } }, testAuth());
    expect(r.status).toBe(200);
    expect(listPanels().some((p) => p.id === "own-key-panel")).toBe(true);
  });

  test("control: a keyless same-origin participation write is accepted where the same request on uiPanel_write is refused", async () => {
    const q = await post("/v2/impulses/resolve", { pointer: { type: "uiQuestion_write", id: "q-browser", title: "q", body: "b" } }, testAuth());
    expect(q.status).toBe(200);
    const panel = ((await q.json()) as { body: { id: string; revision: number } }).body;
    const r = await post("/api/participation", { panel_id: panel.id, panel_revision: panel.revision, response_id: "r-browser", kind: "answer", value: "yes" }, { Origin: HERE });
    expect(r.status).toBe(200);
    const refused = await post("/v2/impulses/resolve", { pointer: { type: "uiFeedback", panel_id: panel.id, response_id: "r-browser-2", value: "yes" } }, { Origin: HERE });
    expect(refused.status).toBe(401);
  });

  test("control: the reads stay open, and /health counts each refusal by reason and caller", async () => {
    const r = await post("/v2/impulses/resolve", { pointer: { type: "uiQuestion" } });
    expect(r.status).toBe(200);
    const before = await refusedCount("key_rejected", "keyed-unknown");
    await post("/api/observations", { obs_type: "click", panel_id: "p-1" }, { Authorization: "ApiKey not-a-real-key" });
    expect(await refusedCount("key_rejected", "keyed-unknown")).toBe(before + 1);
  });
});

/*
 * A, THE STAMP. A stored record names the caller the route admitted, never the pointer's
 * claim: a panel its creator's key class and validated label (the learner reads it,
 * src/importance-learn.ts testOriginPanels), a feedback or observation record `caller`.
 */
describe("a stored record carries the admitted caller, not its own claim", () => {
  const getPanel = async (id: string) => (await import("../src/store.ts")).getPanel(id) as Record<string, unknown> | undefined;

  test("must-fail: a valid key's panel claiming origin person is stored with the key's identity", async () => {
    const r = await post("/v2/impulses/resolve", { pointer: { type: "uiPanel_write", id: "a-claim", title: "t", body: "b", origin: "person", producer: "claimed" } }, { Authorization: "ApiKey valid-service-2" });
    expect(r.status).toBe(200);
    expect(await getPanel("a-claim")).toMatchObject({ origin: "automated", producer: "key:svc-key-1" });
  });

  test("must-fail: an operator-scoped key's panel is stamped operator; a test key is classified by its key", async () => {
    await post("/v2/impulses/resolve", { pointer: { type: "uiQuestion_write", id: "a-op", title: "q", body: "b" } }, { Authorization: "ApiKey valid-operator-2" });
    expect(await getPanel("a-op")).toMatchObject({ origin: "operator", producer: "key:op-key-1" });
    await post("/v2/impulses/resolve", { pointer: { type: "uiQuestion_write", id: "a-test", title: "q", body: "b" } }, testAuth());
    expect(await getPanel("a-test")).toMatchObject({ origin: "automated", producer: "node-self" });
    await post("/v2/impulses/resolve", { pointer: { type: "human_input", solicitation_id: "a-s", brief: "a question" } }, { Authorization: "ApiKey valid-service-3" });
    expect(await getPanel("solicitation-a-s")).toMatchObject({ origin: "automated", producer: "key:svc-key-1" });
  });

  test("must-fail: a keyless same-origin participation answer is stored browser-unverified", async () => {
    const q = await post("/v2/impulses/resolve", { pointer: { type: "uiQuestion_write", id: "a-q", title: "q", body: "b" } }, testAuth());
    const panel = ((await q.json()) as { body: { id: string; revision: number } }).body;
    const r = await post("/api/participation", { panel_id: panel.id, panel_revision: panel.revision, response_id: "a-r", kind: "answer", value: "yes" }, { Origin: HERE });
    expect(r.status).toBe(200);
    const { recentFeedback } = await import("../src/store.ts");
    expect(recentFeedback(500).find((f) => f.id === "a-r")).toMatchObject({ caller: { origin: "browser-unverified", label: "browser-unverified" } });
    const o = await post("/api/observations", { obs_type: "click", panel_id: panel.id }, { Origin: HERE });
    expect(o.status).toBe(200);
    const { recentObservations } = await import("../src/store.ts");
    expect(recentObservations(500).filter((x) => x.panelId === panel.id).at(-1)).toMatchObject({ caller: { origin: "browser-unverified" } });
  });

  test("control: an update keeps the creator's stamp, and a panel created unstamped stays unstamped", async () => {
    await post("/v2/impulses/resolve", { pointer: { type: "uiPanel_write", id: "a-keep", title: "t", body: "b" } }, { Authorization: "ApiKey valid-operator-3" });
    await post("/v2/impulses/resolve", { pointer: { type: "uiPanel_write", id: "a-keep", title: "t2" } }, testAuth());
    expect(await getPanel("a-keep")).toMatchObject({ title: "t2", origin: "operator", producer: "key:op-key-1" });
    const { upsertPanel } = await import("../src/store.ts");
    upsertPanel({ id: "a-legacy", title: "t", body: "b", kind: "info", importance: "medium" });
    await post("/v2/impulses/resolve", { pointer: { type: "uiPanel_write", id: "a-legacy", title: "t2" } }, { Authorization: "ApiKey valid-service-4" });
    const legacy = await getPanel("a-legacy");
    expect(legacy?.["title"]).toBe("t2");
    expect(legacy?.["origin"]).toBeUndefined();
    expect(legacy?.["producer"]).toBeUndefined();
  });
});

/*
 * The page frame (ad845d0) stores markup under a frame-session cookie that the shell hands to
 * whoever loads "/", so the cookie names no caller. Its write names one through the seam like
 * every other: the page (same-origin, keyless) is admitted, a keyless non-browser is not.
 */
describe("/api/page-frame names its caller", () => {
  const frameSession = async (): Promise<string> => {
    const r = await app.request(`${HERE}/`);
    return (r.headers.get("set-cookie") ?? "").split(";")[0]!;
  };

  test("must-fail: a keyless caller with no Origin cannot store a frame, even with the cookie the shell handed it", async () => {
    const cookie = await frameSession();
    expect(cookie).toContain("=");
    const r = await post("/api/page-frame", { source: "<p>keyless</p>" }, { cookie });
    expect(r.status).toBe(401);
    expect(((await r.json()) as { reason?: string }).reason).toBe("keyless_not_allowlisted");
  });

  test("must-fail: the page (same-origin, keyless) still stores a frame with its session, stamped browser-unverified", async () => {
    const cookie = await frameSession();
    const r = await post("/api/page-frame", { source: "<p>page</p>" }, { cookie, Origin: HERE });
    expect(r.status).toBe(200);
    const id = ((await r.json()) as { id?: unknown }).id;
    expect(typeof id).toBe("string");
    // The frame keeps the caller it was admitted as, like every other browser write.
    const { __frameCallerForTests } = await import("../src/page-frame.ts");
    expect(__frameCallerForTests(id as string)).toEqual({ origin: "browser-unverified", label: "browser-unverified" });
  });
});
