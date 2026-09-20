// B-3 falsifier: the uiQuestion READER filtered to kind==="question", so every
// escalation the substrate wrote to this surface was invisible to the browser.
//
// CONTAINMENT, never a count: `total === N` passes for the wrong reason and
// breaks on unrelated seeding.
//
// The kind:"question" positive control runs in the SAME invocation so
// "the escalation became visible" is distinguishable from "everything became
// visible", and the kind:"info" case proves the filter still filters.
// PROCESS-SHARED STORE: `../src/store.ts` is module-level in-memory state loaded
// ONCE per `bun test` process, so `/api/questions` here returns EVERY solicitable
// panel any sibling file wrote (blocker4-repro.test.ts, solicitation-store.test.ts,
// participation.test.ts, …) in whatever order bun ran them — the logged id list is
// routinely majority other-file ids. Every id below therefore carries this file's
// `b3r-` prefix, and every assertion is `toContain` / `not.toContain` on an id
// this file wrote, or scoped to a single-id lookup. Do NOT convert any of these to
// `toHaveLength(n)` or `total === n`: it would pass today and flap the moment a
// sibling file is added, renamed, or reordered.
import { describe, expect, test } from "bun:test";
import { impulsesRouter } from "../src/routes/impulses.ts";
import { participationRouter } from "../src/routes/participation.ts";

async function write(pointer: Record<string, unknown>) {
  const r = await impulsesRouter.request("/v2/impulses/resolve", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pointer }),
  });
  return { status: r.status, json: await r.json() as any };
}

async function questionIds(): Promise<string[]> {
  const r = await participationRouter.request("/api/questions");
  const j = await r.json() as any;
  expect(r.status).toBe(200);
  return (j.body.questions as { id: string }[]).map(q => q.id);
}

describe("B-3 — the reader surfaces every solicitation", () => {
  test("escalations, invented kinds and questions are all listed; info is not", async () => {
    // exactly as development-vessel's gap-to-feature.ts:1043 emits it — no asks
    const esc = await write({ type: "uiQuestion_write", id: "b3r-needs-human",
      title: "Gap needs a human decision", body: "Gap X has failed auto-repair 8+ times.",
      kind: "gap_needs_human", importance: "high" });
    expect(esc.status).toBe(200);
    expect(esc.json.body.asks).toBeUndefined();

    const invented = await write({ type: "uiQuestion_write", id: "b3r-invented-kind",
      title: "Something new", body: "b", kind: "escalation_kind_nobody_invented_yet" });
    expect(invented.status).toBe(200);

    // POSITIVE CONTROL — listed before AND after; if this is absent the reader
    // itself is broken and the other assertions say nothing.
    const control = await write({ type: "uiQuestion_write", id: "b3r-plain-question",
      title: "A plain question", body: "b", kind: "question",
      asks: [{ id: "a1", prompt: "which?", type: "text" }] });
    expect(control.status).toBe(200);

    // NEGATIVE CONTROL — must stay invisible.
    const info = await write({ type: "uiPanel_write", id: "b3r-info-panel",
      title: "FYI", body: "nothing asked", kind: "info" });
    expect(info.status).toBe(200);

    const ids = await questionIds();
    console.log("QUESTION IDS (%d): %j", ids.length, ids);
    expect(ids).toContain("b3r-plain-question");              // control
    expect(ids).toContain("b3r-needs-human");                 // the fix
    expect(ids).toContain("b3r-invented-kind");               // kills an allowlist
    expect(ids).not.toContain("b3r-info-panel");              // still filters

    // the single-panel lookup path must agree with the list path
    const single = await write({ type: "uiQuestion", id: "b3r-needs-human" });
    console.log("SINGLE LOOKUP %j", JSON.stringify(single.json.body).slice(0, 200));
    expect(single.json.body.questions.map((q: { id: string }) => q.id)).toEqual(["b3r-needs-human"]);
  });
});
