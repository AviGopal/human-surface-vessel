/**
 * Gap threads join the attempt ledger to the gap store by the fields the ledger
 * records (gap_id, attempt_id, dispatch_id, commit), never by goal text. Shapes:
 * one node's ledger on 10-18 held 1,940 attempt intents, all with gap_id, 155
 * with a dispatch_id; 17 outcomes had landed a commit.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { joinGapThreads } from "../src/gap-threads.ts";
import { proxyRouter, resetGapThreadsCacheForTest } from "../src/routes/proxy.ts";

const gaps = [
  { id: "g-open", summary: "the page's own reads fail", status: "open", severity: "high", reopen_count: 1, first_detected_at: "2026-10-17T11:00:00Z" },
  { id: "g-quiet", summary: "never attempted", status: "open" },
];
const intents = [
  { attempt_id: "a1", gap_id: "g-open", route: "gap_to_feature", stage: "compose", registered_at: "2026-10-17T11:10:00Z", dispatch_id: null },
  { attempt_id: "a2", gap_id: "g-open", route: "feature_compose", stage: "compose", registered_at: "2026-10-17T12:00:00Z", dispatch_id: "d-2" },
  { attempt_id: "a3", gap_id: "g-gone", route: "gap_to_feature", registered_at: "2026-10-16T09:00:00Z" },
  // The goal text names g-open, but no gap_id field links it: it must not join.
  { attempt_id: "a4", goal: "fix g-open please", registered_at: "2026-10-17T13:00:00Z" },
];
const outcomes = [
  { attempt_id: "a1", gap_id: "g-open", at: "2026-10-17T11:20:00Z", outcome: "not_landed", verdict: "falsifier_still_red", landed: false, commit: null },
  { attempt_id: "a2", gap_id: "g-open", at: "2026-10-17T12:30:00Z", outcome: "landed", verdict: "verified", landed: true, commit: "0c0d640" },
];
const settlements = [{ attempt_id: "a1", dispatch_id: "d-1", verdict: "regressed" }];

describe("joinGapThreads", () => {
  test("attempts join by gap_id; runs come from the intent or its settlement; commits from the outcome", () => {
    const t = joinGapThreads(gaps, intents, outcomes, settlements);
    expect(t.map((x) => x.gapId)).toEqual(["g-open", "g-gone"]);
    const open = t[0]!;
    expect(open).toMatchObject({ summary: "the page's own reads fail", status: "open", reopenCount: 1, attemptCount: 2, landedCount: 1 });
    expect(open.attempts.map((a) => [a.attemptId, a.dispatchId, a.landed, a.commit])).toEqual([
      ["a2", "d-2", true, "0c0d640"],
      ["a1", "d-1", false, null],
    ]);
  });

  test("a gap no longer in the store keeps its thread, without a summary; text that only mentions a gap does not join", () => {
    const t = joinGapThreads(gaps, intents, outcomes, settlements);
    expect(t[1]).toMatchObject({ gapId: "g-gone", summary: null, attemptCount: 1 });
    expect(t.flatMap((x) => x.attempts.map((a) => a.attemptId))).not.toContain("a4");
  });
});

describe("/api/gap-threads", () => {
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body ?? "{}")) as { pointer?: { type?: string }; impulse?: { pointer?: { type?: string; kind?: string } } };
    if (url.endsWith("/resolve") && body.pointer?.type === "vesselCapability") return new Response(JSON.stringify({ content: { vessels: [] } }), { status: 200 });
    const p = body.impulse?.pointer;
    calls++;
    if (p?.type === "substrateGap") return new Response(JSON.stringify({ body: { gaps } }), { status: 200 });
    if (p?.type === "attemptLedger") {
      const rec = p.kind === "attemptIntent" ? intents : p.kind === "attemptOutcome" ? outcomes : settlements;
      return new Response(JSON.stringify({ body: { kind: p.kind, records: rec.map((r) => ({ kind: p.kind, record: r })) } }), { status: 200 });
    }
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
  afterAll(() => {
    globalThis.fetch = realFetch;
  });
  const app = new Hono();
  app.route("/", proxyRouter);

  test("must-fail: serves this node's gap threads with totals, and caches the join", async () => {
    resetGapThreadsCacheForTest();
    const res = await app.request("/api/gap-threads");
    expect(res.status).toBe(200);
    const j = (await res.json()) as { body: { scope: string; threads: { gapId: string }[]; totals: Record<string, number> } };
    expect(j.body.scope).toBe("this node");
    expect(j.body.threads.map((t) => t.gapId)).toEqual(["g-open", "g-gone"]);
    expect(j.body.totals).toEqual({ attempts: 4, landed: 1, withRun: 1 });
    const before = calls;
    await app.request("/api/gap-threads");
    expect(calls).toBe(before);
  });
});
