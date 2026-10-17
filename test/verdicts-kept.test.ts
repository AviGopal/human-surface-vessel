/**
 * A verdict is an observation from its source, kept whatever the learning corpus
 * does with it (user ruling 10-17). Before this, every grade from the surface was
 * refused upstream for want of a human-scoped credential and nothing was kept.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { proxyRouter } from "../src/routes/proxy.ts";
import { readParticipation } from "../src/participation-journal.ts";

const realFetch = globalThis.fetch;
const upstream: string[] = [];
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  upstream.push(String(init?.body ?? ""));
  // The corpus refuses, as it does today for a surface grade.
  return new Response(JSON.stringify({ error: "scope verdict:human required" }), { status: 403 });
}) as typeof fetch;
afterAll(() => {
  globalThis.fetch = realFetch;
});

const app = new Hono();
app.route("/", proxyRouter);

describe("verdicts kept on the run", () => {
  test("must-fail: a grade the corpus refuses is still kept, with its source and the judge's verdict", async () => {
    const res = await app.request("/api/grade", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ execution_id: "e-1", dispatch_id: "d-rain", goal: "Where is it raining?", verdict: "not_achieved", notes: "Wrong answer — an empty search", judge_reached: true, about: { pool_id: "p-7", shape: "human_input", produced_by: "satisfier:human_input", provenance: "without-a-person", extra: { x: 1 } } }),
    });
    // The corpus's answer is passed through unchanged.
    expect(res.status).toBe(403);
    expect(upstream.filter((b) => b.includes('"e-1"')).length).toBe(1);
    const kept = (await (await app.request("/api/verdicts?dispatch_id=d-rain")).json()) as { body: { verdicts: Record<string, unknown>[] } };
    expect(kept.body.verdicts).toHaveLength(1);
    expect(kept.body.verdicts[0]).toMatchObject({ dispatch_id: "d-rain", verdict: "not_achieved", note: "Wrong answer — an empty search", source: "person", judge_reached: true });
    // Which result was judged, and where it came from; nothing beyond the named strings is kept.
    expect(kept.body.verdicts[0]?.["about"]).toEqual({ pool_id: "p-7", shape: "human_input", produced_by: "satisfier:human_input", provenance: "without-a-person" });
    // Journaled, so it outlives a restart.
    const journaled = readParticipation("interactorObservation_write").filter(
      (o) => (o as { type?: string; body?: { dispatch_id?: string } }).type === "verdict" && (o as { body?: { dispatch_id?: string } }).body?.dispatch_id === "d-rain",
    );
    expect(journaled.length).toBe(1);
  });

  test("another run's verdicts are not mixed in", async () => {
    const other = (await (await app.request("/api/verdicts?dispatch_id=d-other")).json()) as { body: { verdicts: unknown[] } };
    expect(other.body.verdicts).toHaveLength(0);
  });
});
