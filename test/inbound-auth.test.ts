/**
 * FALSIFIER for the-human-surfaces-api-run-goal-route-has-no-inbound-auth-and-forwards-with-the-fleet-key-so-an-unauthenticated-caller-starts-a-walk,
 * widened by qa to every human-surface write route behind one seam (src/inbound-auth.ts).
 *
 * Through the whole app (index.ts), so refuseForeignOriginWrites runs first as it does live.
 * Identity is a real HTTP stub on 127.0.0.1 (port 0): it authenticates keys that start with
 * "valid-", answers keyId and scopes, and refuses the rest. Every other outbound call
 * (goal-host, discovery, activity-api) is recorded and answered here, so "never reaches
 * goal-host" is read off the record, not assumed.
 */
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { testAuth } from "./setup.ts";

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
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.endsWith("/v1/auth/resolve")) return realFetch(input as never, init);
  let body: Record<string, unknown> = {};
  try { body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>; } catch { /* not JSON */ }
  outbound.push({ url, body });
  const type = String(body["type"] ?? (body["pointer"] as { type?: unknown } | undefined)?.type ?? "");
  if (type === "vesselCapability") return new Response(JSON.stringify({ content: { vessels: [] } }), { status: 200 });
  if (type === "goalDispatchAsync") return new Response(JSON.stringify({ dispatchId: `d-${outbound.length}`, status: "running" }), { status: 202 });
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
  { route: "/api/run-goal", body: { goal: "What is 2 + 2?" } },
  { route: "/api/resolve", body: { type: "poolImpulse_write", dispatchId: "d-x", shape: "note", content: "c" } },
  { route: "/api/discovery/resolve", body: { pointer: { type: "vesselCapability", shape: "x" } } },
  { route: "/api/grade", body: { execution_id: "e-1", verdict: "reached" } },
  { route: "/api/feedback", body: { panel_id: "region-1", value: "wrong", kind: "wrong" } },
  { route: "/api/observations", body: { obs_type: "click", panel_id: "p-1" } },
  { route: "/api/surface-intent", body: { text: "make the text bigger" } },
  { route: "/api/calibration/grade", body: { window_id: "w-1", dispatch_id: "d-1", grade: "reached" } },
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

  test("must-fail: a keyless same-origin /api/resolve of a shape the page does not send is refused", async () => {
    // In the surface's shape list, but not a shape the page sends: the caller gate refuses it.
    for (const type of ["vesselCapability", "goal_verification_label_write", "interactorObservation"]) {
      const r = await post("/api/resolve", { type, dispatchId: "d-x" }, { Origin: HERE });
      expect({ type, status: r.status }).toEqual({ type, status: 401 });
      expect(((await r.json()) as { reason?: string }).reason).toBe("keyless_not_allowlisted");
    }
    // Outside the shape list: refused before any caller is asked, as it always was.
    const executing = await post("/api/resolve", { type: "goalDispatchAsync", goal: "x" }, { Origin: HERE });
    expect(executing.status).toBe(403);
    expect(outbound).toEqual([]);
  });

  test("must-fail: a valid ApiKey is admitted and named by its validated label on /api/run-goal", async () => {
    const r = await post("/api/run-goal", { goal: "What is 2 + 2?" }, { Authorization: "ApiKey valid-service-1" });
    expect(r.status).toBe(202);
    const sent = outbound.find((o) => o.body["type"] === "goalDispatchAsync");
    expect(sent?.body["operator"]).toBe("key:svc-key-1");
  });

  test("must-fail: a browser-supplied operator is ignored on /api/run-goal", async () => {
    const browser = await post("/api/run-goal", { goal: "What is 2 + 2?", operator: "operator:claude-avi" }, { Origin: HERE });
    expect(browser.status).toBe(202);
    expect(outbound.filter((o) => o.body["type"] === "goalDispatchAsync").at(-1)?.body["operator"]).toBe("human-surface");
    const keyed = await post("/api/run-goal", { goal: "What is 2 + 2?", operator: "operator:claude-avi" }, { Authorization: "ApiKey valid-operator-1" });
    expect(keyed.status).toBe(202);
    expect(outbound.filter((o) => o.body["type"] === "goalDispatchAsync").at(-1)?.body["operator"]).toBe("key:op-key-1");
  });

  test("must-fail: an invalid key is refused key_rejected", async () => {
    const r = await post("/v2/impulses/resolve", { pointer: { type: "uiPanel_write", id: "bad-key-panel", title: "t", body: "b" } }, { Authorization: "ApiKey not-a-real-key" });
    expect(r.status).toBe(401);
    expect(((await r.json()) as { reason?: string }).reason).toBe("key_rejected");
    expect(listPanels().some((p) => p.id === "bad-key-panel")).toBe(false);
  });

  test("must-fail: identity unreachable refuses every other key, identity_unreachable", async () => {
    process.env.IDENTITY_VESSEL_URL = IDENTITY_DOWN;
    const r = await post("/api/run-goal", { goal: "What is 2 + 2?" }, { Authorization: "ApiKey valid-during-outage-1" });
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
    await post("/api/run-goal", { goal: "x" }, { Authorization: "ApiKey not-a-real-key" });
    expect(await refusedCount("key_rejected", "keyed-unknown")).toBe(before + 1);
  });
});
