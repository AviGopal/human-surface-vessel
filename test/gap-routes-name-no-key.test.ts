/**
 * The gap routes (/api/gaps, /api/gaps/:id) serve no key id: a gap row has no field that names
 * whoever wrote it. The gap store records a write's key only as a 6-character prefix in its own
 * write-event log (development-vessel substrate-gap.ts, appendGapWriteEvent), which the
 * `substrateGap` read does not serve; a gap names its writer by the session marker in `operator`.
 * So the routes carry no unnaming: this pins that a gap a person reported, as the store serves it,
 * reaches the browser with no key id, and fails if the store or the route starts serving one.
 *
 * Shape: one node 11-11. A key id reached signed-out viewers through the records read
 * (agf_m1wjuqnt8og3); these two routes were read for the same field and serve none.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { restoreNativeGlobals } from "./setup.ts";
import { proxyRouter } from "../src/routes/proxy.ts";
import { DISCOVERY_ENDPOINT, PORT } from "../src/config.ts";

const KEY_ID = "key__test-person";
/** A ui_legibility gap a person reported, with the fields the gap store serves (SubstrateGap). */
const GAP = {
  id: "agf_test-gap",
  category: "ui_legibility",
  source: "human_reported",
  summary: "The section that tracks an ask grows too large.",
  detected_at: "2026-11-11T16:00:00.000Z",
  status: "open",
  route: "human_required",
  classification_metadata: { operator: "operator:qa-test" },
  created_at: "2026-11-11T16:00:00.000Z",
  updated_at: "2026-11-11T16:00:00.000Z",
};

await restoreNativeGlobals();
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL) => {
  if (String(input).startsWith(DISCOVERY_ENDPOINT.replace(/\/+$/, ""))) return new Response(JSON.stringify({ resolved: true, shape: "substrateGap", body: { gaps: [GAP] } }), { status: 200, headers: { "Content-Type": "application/json" } });
  return Response.json({});
}) as typeof fetch;
afterAll(() => {
  globalThis.fetch = realFetch;
});

const app = new Hono();
app.route("/", proxyRouter);
const own = `http://127.0.0.1:${PORT + 10_000}`;

describe("the gap routes serve no key id", () => {
  test("/api/gaps: a person-reported gap reaches the browser with no key id", async () => {
    const r = await app.request(`${own}/api/gaps`);
    const text = await r.text();
    expect(r.status).toBe(200);
    expect(JSON.parse(text).gaps[0].id).toBe(GAP.id);
    expect(text).not.toMatch(/key_[A-Za-z0-9_-]+/);
  });

  test("/api/gaps/:id: the same gap by id carries no key id", async () => {
    const r = await app.request(`${own}/api/gaps/${GAP.id}`);
    const text = await r.text();
    expect(r.status).toBe(200);
    expect(JSON.parse(text).gap.id).toBe(GAP.id);
    expect(text).not.toMatch(/key_[A-Za-z0-9_-]+/);
  });

  test("control: the check sees a key id where one is served", () => {
    expect(JSON.stringify({ ...GAP, writer: KEY_ID })).toMatch(/key_[A-Za-z0-9_-]+/);
  });
});
