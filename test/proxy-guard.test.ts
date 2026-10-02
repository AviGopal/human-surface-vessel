/**
 * The proxy is a security boundary: a write from another site is refused before
 * any route runs, and `/api/resolve` forwards only the shapes the UI resolves.
 *
 * Before 10-02, a `text/plain` POST from any origin (a CORS "simple request",
 * sent with no preflight) reached `/api/resolve` and was forwarded to goal-host
 * with the fleet key — any page open on the host could dispatch goals.
 */
import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { isOwnOrigin, proxyRouter, refuseForeignOriginWrites, resolveTypeOf } from "../src/routes/proxy.ts";
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

function post(path: string, body: string, headers: Record<string, string>): Promise<Response> {
  return app.request(path, { method: "POST", body, headers });
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

  test("the surface's own page and service callers (no Origin) pass", async () => {
    const page = await post("/api/resolve", '{"type":"activeDispatches"}', { "Content-Type": "application/json", Origin: own });
    expect(page.status).toBe(200);
    const service = await post("/api/resolve", '{"type":"activeDispatches"}', { "Content-Type": "application/json" });
    expect(service.status).toBe(200);
  });

  test("reads are never refused for their Origin", async () => {
    const res = await app.request("/api/render-policy", { headers: { Origin: "https://example.invalid" } });
    expect(res.status).not.toBe(403);
  });

  test("isOwnOrigin accepts the container and host-mapped ports only", () => {
    expect(isOwnOrigin(`http://127.0.0.1:${PORT}`)).toBe(true);
    expect(isOwnOrigin(own)).toBe(true);
    expect(isOwnOrigin("http://127.0.0.1:5173")).toBe(false);
    expect(isOwnOrigin("null")).toBe(false);
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
    const res = await post("/api/resolve", body, { "Content-Type": "application/json" });
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
