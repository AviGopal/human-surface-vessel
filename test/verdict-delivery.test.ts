/**
 * A person's verdict is kept on the run whatever happens upstream, and so is what
 * upstream answered: activity-api's own response to the surface's request, kept
 * verbatim beside the verdict (a verdict_delivery observation), so "not recorded"
 * survives a reload and says why in aa's words. Nothing retries the write.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { proxyRouter } from "../src/routes/proxy.ts";
import { readParticipation } from "../src/participation-journal.ts";

type Upstream = { status: number; body: unknown } | "unreachable";
let next: Upstream = { status: 200, body: { success: true } };
const labelWrites: string[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  if (String(input).includes("/v2/impulses/resolve") && String(init?.body ?? "").includes("goal_verification_label_write")) {
    labelWrites.push(String(init?.body ?? ""));
    if (next === "unreachable") throw new Error("connect ECONNREFUSED");
    return new Response(JSON.stringify(next.body), { status: next.status, headers: { "content-type": "application/json" } });
  }
  return new Response("{}", { status: 404 });
}) as typeof fetch;
afterAll(() => {
  globalThis.fetch = realFetch;
});

const app = new Hono();
app.route("/", proxyRouter);

async function grade(dispatchId: string, upstream: Upstream) {
  next = upstream;
  return app.request("/api/grade", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ execution_id: `e-${dispatchId}`, dispatch_id: dispatchId, goal: "Where is it raining?", verdict: "not_achieved", notes: "Wrong answer", judge_reached: true }),
  });
}

async function kept(dispatchId: string) {
  const r = await app.request(`/api/verdicts?dispatch_id=${dispatchId}`);
  return ((await r.json()) as { body: { verdicts: Array<Record<string, unknown>> } }).body.verdicts;
}

const REFUSAL = 'labeler "human" requires a credential issued with the "verdict:human" scope (or "admin"), attributable by key id and not on-behalf-of a peer node';

describe("what upstream answered, kept beside the verdict", () => {
  test("must-fail: a refusal is kept with aa's own words, and the client still gets aa's answer", async () => {
    const r = await grade("d-refused", { status: 403, body: { success: false, error: REFUSAL } });
    expect(r.status).toBe(403);
    expect(((await r.json()) as { error: string }).error).toBe(REFUSAL);
    const [v] = await kept("d-refused");
    expect(v?.["verdict"]).toBe("not_achieved");
    expect(v?.["delivery"]).toMatchObject({ recorded: false, status: 403, reason: REFUSAL });
  });

  test("must-fail: a 2xx whose body says success:false is not recorded (the hollow success)", async () => {
    await grade("d-hollow", { status: 200, body: { success: false, error: "nothing written" } });
    expect((await kept("d-hollow"))[0]?.["delivery"]).toMatchObject({ recorded: false, status: 200, reason: "nothing written" });
  });

  test("must-fail: an unreachable upstream keeps the verdict, says so, and writes the label once", async () => {
    const before = labelWrites.length;
    await grade("d-down", "unreachable");
    expect(labelWrites.length - before).toBe(1);
    const [v] = await kept("d-down");
    expect(v?.["verdict"]).toBe("not_achieved");
    expect(v?.["delivery"]).toMatchObject({ recorded: false, reason: "unreachable" });
  });

  test("a recorded verdict says so, and the delivery is journaled with the verdict it belongs to", async () => {
    await grade("d-ok", { status: 200, body: { success: true } });
    const [v] = await kept("d-ok");
    expect(v?.["delivery"]).toMatchObject({ recorded: true, status: 200 });
    const journaled = readParticipation("interactorObservation_write").filter(
      (o) => (o as { type?: string; body?: { dispatch_id?: string } }).type === "verdict_delivery" && (o as { body?: { dispatch_id?: string } }).body?.dispatch_id === "d-ok",
    ) as Array<{ body: { verdict_at: number } }>;
    expect(journaled.length).toBe(1);
    expect(journaled[0]!.body.verdict_at).toBe(v?.["observedAt"]);
  });
});
