// B-2 falsifier: the STORE-side answer guard rejected an answer to any panel
// whose kind was not literally "question".
//
// The human path, end to end: a `gap_needs_human` escalation (written exactly as
// development-vessel's gap-to-feature.ts:1043 emits it — title/body/kind/
// importance, NO asks) is answered through POST /api/participation at the
// correct revision. Before the fix that returned 409 "The question changed" —
// a false statement about a panel that had not changed.
//
// The invented-kind clause is what kills an allowlist patch: it must pass for a
// kind no code has ever heard of.
// PROCESS-SHARED STORE: `../src/store.ts` holds panels and feedback in
// module-level memory, loaded ONCE per `bun test` process and shared with
// blocker4-repro.test.ts and solicitation-reader.test.ts in whatever order bun
// runs the files. Every panel id and response_id below therefore carries this
// file's `b2s-` prefix, and every assertion looks up its OWN id
// (`recentFeedback(...).find/some(f => f.id === "b2s-…")`) — never a count or a
// length over the shared store. Do not turn any of these into
// `toHaveLength(n)`: it would pass today and flap the moment a sibling file is
// added, renamed, or reordered. Note `recentFeedback(1000)` is a WINDOW over the
// shared list, so a negative assertion on it is "not in the last 50", which is
// why each id is unique per file — and why these calls pass 1000, not the
// default 50: over the WHOLE retained list a negative assertion means "was
// never recorded" instead of the weaker "not among the last 50".
import { describe, expect, test } from "bun:test";
import { impulsesRouter } from "../src/routes/impulses.ts";
import { participationRouter } from "../src/routes/participation.ts";
import { recentFeedback } from "../src/store.ts";

async function write(pointer: Record<string, unknown>) {
  const r = await impulsesRouter.request("/v2/impulses/resolve", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pointer }),
  });
  return { status: r.status, json: await r.json() as any };
}

async function participate(body: Record<string, unknown>) {
  const r = await participationRouter.request("/api/participation", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  return { status: r.status, json: await r.json() as any };
}

/** Writes an escalation panel shaped exactly like gap-to-feature.ts's. */
async function escalation(id: string, kind: string) {
  const seed = await write({
    type: "uiQuestion_write", id,
    title: "Gap needs a human decision",
    body: `Gap ${id} has failed auto-repair 8+ times with 0 lands.`,
    kind, importance: "high",
  });
  expect(seed.status).toBe(200);
  expect(seed.json.body.asks).toBeUndefined(); // no asks, as in production
  return seed.json.body as { id: string; revision: number; kind: string };
}

describe("B-2 — isSolicitation, store side", () => {
  test("a gap_needs_human escalation can be ANSWERED at the correct revision", async () => {
    const panel = await escalation("b2s-needs-human-real", "gap_needs_human");
    const res = await participate({
      panel_id: panel.id, panel_revision: panel.revision,
      response_id: "b2s-fdbk-real", kind: "answer", value: "Drop it — the premise is false.",
    });
    console.log("gap_needs_human answer status=%d json=%j", res.status, JSON.stringify(res.json).slice(0, 220));
    expect(res.status).toBe(200);
    const persisted = recentFeedback(1000).find(f => f.id === "b2s-fdbk-real");
    expect(persisted).toBeDefined();
    expect(persisted!.value).toBe("Drop it — the premise is false.");
    expect(persisted!.panelRevision).toBe(panel.revision);
  });

  // NON-NEGOTIABLE: an allowlist patch passes the case above and fails this one.
  test("an INVENTED kind nobody has heard of can be answered too", async () => {
    const panel = await escalation("b2s-invented-kind", "escalation_kind_nobody_invented_yet");
    expect(panel.kind).toBe("escalation_kind_nobody_invented_yet"); // stored uncoerced
    const res = await participate({
      panel_id: panel.id, panel_revision: panel.revision,
      response_id: "b2s-fdbk-invented", kind: "answer", value: "answered anyway",
    });
    console.log("invented-kind answer status=%d json=%j", res.status, JSON.stringify(res.json).slice(0, 220));
    expect(res.status).toBe(200);
    expect(recentFeedback(1000).some(f => f.id === "b2s-fdbk-invented")).toBe(true);
  });

  // The revision path was never exercised on a non-"question" kind: before the
  // three-way split there was no way to reach it, because the kind check fired
  // first and stole the message.
  test("a genuine revision mismatch reports the REVISION, not a missing or informational panel", async () => {
    const panel = await escalation("b2s-needs-human-stale", "gap_needs_human");
    const updated = await write({ type: "uiQuestion_write", id: panel.id, title: "Revised escalation" });
    expect(updated.status).toBe(200);
    expect(updated.json.body.revision).toBe(panel.revision + 1);
    const res = await participate({
      panel_id: panel.id, panel_revision: panel.revision, // the STALE revision
      response_id: "b2s-fdbk-stale", kind: "answer", value: "too late",
    });
    console.log("stale-revision status=%d error=%j", res.status, res.json.error);
    expect(res.status).toBe(409);
    expect(String(res.json.error)).toMatch(/changed since you loaded it/i);
    expect(recentFeedback(1000).some(f => f.id === "b2s-fdbk-stale")).toBe(false);
  });

  test("a MISSING panel reports unavailability, never informational-ness", async () => {
    const res = await participate({
      panel_id: "b2s-no-such-panel", panel_revision: 1,
      response_id: "b2s-fdbk-missing", kind: "answer", value: "x",
    });
    console.log("missing-panel status=%d error=%j", res.status, res.json.error);
    expect(res.status).toBe(409);
    expect(String(res.json.error)).toMatch(/no longer available/i);
    expect(String(res.json.error)).not.toMatch(/informational/i);
  });

  // NEGATIVE CONTROL: the denylist actually denies. Without this, "everything
  // became solicitable" would be indistinguishable from the intended fix.
  test("kind:\"info\" is NOT solicitable", async () => {
    const seed = await write({ type: "uiPanel_write", id: "b2s-info-panel", title: "FYI", body: "nothing asked", kind: "info" });
    expect(seed.status).toBe(200);
    expect(seed.json.body.kind).toBe("info");
    const res = await participate({
      panel_id: "b2s-info-panel", panel_revision: seed.json.body.revision,
      response_id: "b2s-fdbk-info", kind: "answer", value: "x",
    });
    console.log("info-panel status=%d error=%j", res.status, res.json.error);
    expect(res.status).toBe(409);
    expect(String(res.json.error)).toMatch(/informational/i);
    expect(recentFeedback(1000).some(f => f.id === "b2s-fdbk-info")).toBe(false);
  });
});
