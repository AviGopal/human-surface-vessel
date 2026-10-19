/**
 * The proxy is a security boundary: a write from another site is refused before
 * any route runs, and `/api/resolve` forwards only the shapes the UI resolves.
 *
 * Before 10-02, a `text/plain` POST from any origin (a CORS "simple request",
 * sent with no preflight) reached `/api/resolve` and was forwarded to goal-host
 * with the fleet key — any page open on the host could dispatch goals.
 */
import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { testAuth } from "./setup.ts";
import { Hono } from "hono";
import * as proxy from "../src/routes/proxy.ts";
import { isOwnOrigin, proxyRouter, refuseForeignOriginWrites, resolveTypeOf } from "../src/routes/proxy.ts";

// Read through the namespace so the request-level checks below still run (and fail on their own
// assertions) against a parent that lacks this export.
const servedHostnames = (...a: Parameters<typeof proxy.servedHostnames>) => proxy.servedHostnames(...a);
import { PORT } from "../src/config.ts";

const upstream: { url: string; body: string }[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  upstream.push({ url: String(input), body: String(init?.body ?? "") });
  return new Response(JSON.stringify({ resolved: true, shape: "activeDispatches", body: { dispatches: [] } }), { status: 200 });
}) as typeof fetch;

afterEach(() => {
  upstream.length = 0;
});
afterAll(() => {
  globalThis.fetch = realFetch;
});

const app = new Hono();
app.use("*", refuseForeignOriginWrites);
app.route("/", proxyRouter);

const own = `http://127.0.0.1:${PORT + 10_000}`;

/** Sent to the surface at `base`, as a browser on that address would send it. */
function post(path: string, body: string, headers: Record<string, string>, base = own): Promise<Response> {
  return app.request(`${base}${path}`, { method: "POST", body, headers });
}

describe("refuseForeignOriginWrites", () => {
  test("a cross-origin text/plain POST is refused and nothing goes upstream", async () => {
    const res = await post("/api/resolve", '{"type":"activeDispatches"}', {
      "Content-Type": "text/plain",
      Origin: "https://example.invalid",
    });
    expect(res.status).toBe(403);
    expect(upstream.length).toBe(0);
  });

  test("a sandboxed page's Origin: null is refused", async () => {
    const res = await post("/api/run-goal", '{"goal":"x"}', { "Content-Type": "text/plain", Origin: "null" });
    expect(res.status).toBe(403);
    expect(upstream.length).toBe(0);
  });

  test("the surface's own page and keyed service callers (no Origin) pass; a keyless one does not", async () => {
    const page = await post("/api/resolve", '{"type":"activeDispatches"}', { "Content-Type": "application/json", Origin: own });
    expect(page.status).toBe(200);
    const service = await post("/api/resolve", '{"type":"activeDispatches"}', { "Content-Type": "application/json", ...testAuth() });
    expect(service.status).toBe(200);
    // Every write route now names its caller (src/inbound-auth.ts): no key and no Origin is refused.
    const keyless = await post("/api/resolve", '{"type":"activeDispatches"}', { "Content-Type": "application/json" });
    expect(keyless.status).toBe(401);
  });

  test("reads are never refused for their Origin", async () => {
    const res = await app.request("/api/render-policy", { headers: { Origin: "https://example.invalid" } });
    expect(res.status).not.toBe(403);
  });

  test("must-fail: a node publishing under another port prefix accepts its own page", async () => {
    // compose2 publishes 8310 as 26310; its page's writes were refused (10-17).
    const page = await post("/api/resolve", '{"type":"activeDispatches"}', { "Content-Type": "application/json", Origin: "http://127.0.0.1:26310" }, "http://127.0.0.1:26310");
    expect(page.status).toBe(200);
  });

  test("a page on another host or port is refused, even on the surface's own port number", async () => {
    for (const origin of ["http://evil.example:26310", "http://127.0.0.1:18310"]) {
      const res = await post("/api/run-goal", '{"goal":"x"}', { "Content-Type": "text/plain", Origin: origin }, "http://127.0.0.1:26310");
      expect(res.status).toBe(403);
    }
    expect(upstream.length).toBe(0);
  });

  test("must-fail: a rebinding page (Origin and Host both its own name) is refused", async () => {
    // The old port rule accepted any host on the mapped port, so 18310 is the red case at the parent.
    for (const at of [own.replace("127.0.0.1", "evil.example"), "http://evil.example:26310"]) {
      const res = await post("/api/run-goal", '{"goal":"x"}', { "Content-Type": "text/plain", Origin: at }, at);
      expect(res.status).toBe(403);
    }
    expect(upstream.length).toBe(0);
  });

  test("a name the vessel serves is accepted on any port; the served names come from its configuration", () => {
    expect(isOwnOrigin("http://localhost:26310", "http://localhost:26310/api/resolve")).toBe(true);
    expect(servedHostnames("http://surface.lan:8310", "0.0.0.0")).toEqual(new Set(["localhost", "surface.lan"]));
    expect(isOwnOrigin("http://surface.lan:26310", "http://surface.lan:26310/x", servedHostnames("http://surface.lan:8310"))).toBe(true);
    expect(isOwnOrigin("http://surface.lan:26310", "http://surface.lan:26310/x", servedHostnames())).toBe(false);
  });

  test("isOwnOrigin compares the Origin with the address the request was sent to", () => {
    expect(isOwnOrigin(`http://127.0.0.1:${PORT}`, `http://127.0.0.1:${PORT}/api/resolve`)).toBe(true);
    expect(isOwnOrigin(own, `${own}/api/resolve`)).toBe(true);
    expect(isOwnOrigin("http://127.0.0.1:26310", "http://127.0.0.1:26310/api/run-goal")).toBe(true);
    expect(isOwnOrigin("http://127.0.0.1:5173", `${own}/api/resolve`)).toBe(false);
    expect(isOwnOrigin("http://localhost:26310", "http://127.0.0.1:26310/api/resolve")).toBe(false);
    expect(isOwnOrigin("null", `${own}/api/resolve`)).toBe(false);
  });
});

describe("/api/resolve forwards only the UI's shapes", () => {
  test("an executing shape the UI never sends is refused, and nothing goes upstream", async () => {
    for (const type of ["goalDispatchAsync", "uiPanel_write", "memoryNote_write"]) {
      const res = await post("/api/resolve", JSON.stringify({ type, goal: "x" }), { "Content-Type": "application/json" });
      expect(res.status).toBe(403);
    }
    expect(upstream.length).toBe(0);
  });

  test("a body with no type is refused", async () => {
    const res = await post("/api/resolve", "not json", { "Content-Type": "application/json" });
    expect(res.status).toBe(403);
    expect(upstream.length).toBe(0);
  });

  test("an allowed shape is forwarded unchanged", async () => {
    const body = JSON.stringify({ type: "goalWalkState", dispatchId: "d-1" });
    const res = await post("/api/resolve", body, { "Content-Type": "application/json", ...testAuth() });
    expect(res.status).toBe(200);
    expect(upstream.some((u) => u.body === body)).toBe(true);
  });

  test("resolveTypeOf reads the top-level type only", () => {
    expect(resolveTypeOf('{"type":"activeDispatches"}')).toBe("activeDispatches");
    expect(resolveTypeOf('{"impulse":{"type":"goalDispatchAsync"}}')).toBeNull();
    expect(resolveTypeOf("garbage")).toBeNull();
  });
});

describe("fetchGap", () => {
  test("absence is the route's {gap:null}; any other 404 is an error, not 'gone'", async () => {
    const { fetchGap } = await import("../ui/src/api/client.ts");
    const answer = (status: number, body: string) =>
      (globalThis.fetch = (async () => new Response(body, { status })) as unknown as typeof fetch);

    answer(404, JSON.stringify({ gap: null, error: "no gap with that id" }));
    expect(await fetchGap("g-1")).toBeNull();

    answer(404, "Not Found");
    await expect(fetchGap("g-1")).rejects.toThrow("not checked");

    answer(200, JSON.stringify({ gap: { id: "g-1" } }));
    expect(await fetchGap("g-1")).toEqual({ id: "g-1" } as never);

    globalThis.fetch = realFetch;
  });
});
