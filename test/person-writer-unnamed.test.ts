/**
 * The surface's read route, for a viewer who has not signed in, answers with every row a person
 * wrote naming "a person" as its writer; the browser never holds the key id. A row the system
 * wrote, and any row read by a signed-in viewer, is as records wrote it. Without happy-dom, whose
 * Request drops a Cookie header as a browser would (the page is drawn in
 * person-writer-unnamed-dom.test.ts).
 */
import { afterAll, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { restoreNativeGlobals, testAuth } from "./setup.ts";
import { proxyRouter } from "../src/routes/proxy.ts";
import { openSession } from "../src/person-session.ts";
import { DISCOVERY_ENDPOINT, PORT } from "../src/config.ts";

const KEY_ID = "key__test-person";
const ASK = { input_refs: [], shape: "world_changed", what: "Find the most interesting thing on the internet today.", seq: 9510, t: "2026-11-11T16:34:47.891Z", writer: KEY_ID, role: "person", id: "b".repeat(64) };
const ANSWER = { input_refs: [ASK.id], shape: "answer", text: "Here it is.", seq: 9520, t: "2026-11-11T16:40:00.000Z", writer: "described-shape-vessel", role: "described", id: "c".repeat(64) };

await restoreNativeGlobals();
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL) => {
  if (String(input).startsWith(DISCOVERY_ENDPOINT.replace(/\/+$/, ""))) return new Response(JSON.stringify({ resolved: true, shape: "record_read", body: [ASK, ANSWER] }), { status: 200, headers: { "Content-Type": "application/json" } });
  return Response.json({});
}) as typeof fetch;
afterAll(() => {
  globalThis.fetch = realFetch;
});

const app = new Hono();
app.route("/", proxyRouter);
const own = `http://127.0.0.1:${PORT + 10_000}`;

describe("the read route, for a viewer who has not signed in", () => {
  test("must-fail: the route's answer itself carries no key id, so the browser never holds it", async () => {
    const r = await app.request(`${own}/api/discovery/resolve`, { method: "POST", body: JSON.stringify({ pointer: { type: "record_read", shape: "world_changed" } }), headers: { "Content-Type": "application/json", ...testAuth() } });
    const text = await r.text();
    expect(r.status).toBe(200);
    expect(text).not.toContain(KEY_ID);
    expect(JSON.parse(text).body[0].writer).toBe("a person");
  });

  test("control: a row the system wrote keeps its writer", async () => {
    const r = await app.request(`${own}/api/discovery/resolve`, { method: "POST", body: JSON.stringify({ pointer: { type: "record_read", refs_to: ASK.id } }), headers: { "Content-Type": "application/json", ...testAuth() } });
    expect(JSON.parse(await r.text()).body[1].writer).toBe("described-shape-vessel");
  });

  test("control: signed in, the row is as records wrote it", async () => {
    const s = openSession({ apiKey: "test-only-key", userId: "user:person-a", orgId: null, email: null, name: null, expiresAt: Date.now() + 900_000 });
    const cookie = s.cookie.split(";")[0]!;
    const r = await app.request(`${own}/api/discovery/resolve`, { method: "POST", body: JSON.stringify({ pointer: { type: "record_read", shape: "world_changed" } }), headers: { "Content-Type": "application/json", ...testAuth(), Cookie: cookie } });
    expect(JSON.parse(await r.text()).body[0].writer).toBe(KEY_ID);
  });
});
