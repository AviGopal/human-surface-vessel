/**
 * A region's view is written through `uiView_write`, checked against a closed
 * vocabulary, kept per region with a revision log, and read by the page at use
 * time. A refusal names its reason and stores nothing; "undo" restores the view in
 * force before; the views survive a restart. The surface serves `uiView_write` and
 * never advertises `uiView`, so a learned activity that writes views is that shape's
 * only producer and is not refused as a duplicate of the surface.
 */
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { appendFileSync } from "node:fs";
import { join } from "node:path";
import { forgetViews, testAuth } from "./setup.ts";
import { impulsesRouter } from "../src/routes/impulses.ts";
import { proxyRouter } from "../src/routes/proxy.ts";
import { DISCOVERY_SHAPES } from "../src/config.ts";
import { REGISTRATION_PAYLOAD } from "../src/discovery-registration.ts";
import { currentView, resetViewsForTest } from "../src/ui-views.ts";

async function write(pointer: Record<string, unknown>, auth = true) {
  const res = await impulsesRouter.request("/v2/impulses/resolve", {
    method: "POST",
    headers: { "content-type": "application/json", ...(auth ? testAuth() : {}) },
    body: JSON.stringify({ pointer: { type: "uiView_write", ...pointer } }),
  });
  return { status: res.status, json: (await res.json()) as any };
}

async function read(region: string) {
  const res = await proxyRouter.request(`/api/ui-view?region=${region}`);
  return { status: res.status, json: (await res.json()) as any };
}

beforeEach(forgetViews);
afterAll(forgetViews);

describe("uiView_write", () => {
  test("with nothing written, the landing draws its default: the newest own run", async () => {
    const r = await read("landing");
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ region: "landing", revision: 0, id: "landing@0", blocks: ["latest_run"] });
  });

  test("must-fail: a valid view is stored, advances the revision, names its writer, and the page reads it", async () => {
    const w = await write({ region: "landing", blocks: ["needs_you", "changed", "health"], limits: { needs_you: 3 } });
    expect(w.status).toBe(200);
    expect(w.json).toMatchObject({ resolved: true, shape: "uiView_write", body: { region: "landing", revision: 1 } });
    expect(w.json.body.view.writtenBy).toBeTruthy();
    const r = await read("landing");
    expect(r.json).toMatchObject({ revision: 1, id: "landing@1", blocks: ["needs_you", "changed", "health"], limits: { needs_you: 3 } });
  });

  test("must-fail: each refusal is named, answers 422, and stores nothing", async () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ region: "run", blocks: ["health"] }, "unknown_region"],
      [{ region: "landing", blocks: ["health", "weather"] }, "unknown_block"],
      [{ region: "landing", blocks: ["health", "health"] }, "duplicate_block"],
      [{ region: "landing", blocks: [] }, "empty_blocks"],
      [{ region: "landing", blocks: ["needs_you"], limits: { changed: 2 } }, "unknown_limit"],
      [{ region: "landing", blocks: ["needs_you"], limits: { needs_you: 0 } }, "limit_out_of_range"],
      [{ region: "landing", blocks: ["needs_you"], limits: { needs_you: 2.5 } }, "limit_out_of_range"],
    ];
    for (const [pointer, refusal] of cases) {
      const w = await write(pointer);
      expect(w.status).toBe(422);
      expect(w.json.refusal).toBe(refusal);
    }
    expect((await read("landing")).json.revision).toBe(0);
  });

  test("must-fail: a write with no caller is refused and stores nothing", async () => {
    const w = await write({ region: "landing", blocks: ["health"] }, false);
    expect(w.status).toBe(401);
    expect((await read("landing")).json.revision).toBe(0);
  });

  test("must-fail: undo restores the view in force before, as a new revision; undoing the first restores the default", async () => {
    expect((await write({ region: "landing", undo: true })).json.refusal).toBe("nothing_to_undo");
    await write({ region: "landing", blocks: ["needs_you", "changed", "health"] });
    await write({ region: "landing", blocks: ["health"] });
    const u1 = await write({ region: "landing", undo: true });
    expect(u1.json.body.view).toMatchObject({ revision: 3, blocks: ["needs_you", "changed", "health"], undoOf: 1 });
    const u2 = await write({ region: "landing", undo: true });
    expect(u2.json.body.view).toMatchObject({ revision: 4, blocks: ["health"], undoOf: 2 });
    await forgetViews();
    await write({ region: "landing", blocks: ["health"] });
    const u3 = await write({ region: "landing", undo: true });
    expect(u3.json.body.view).toMatchObject({ revision: 2, blocks: ["latest_run"], undoOf: 0 });
  });

  test("must-fail: views survive a restart, and a stored line outside the vocabulary is not replayed", async () => {
    await write({ region: "landing", blocks: ["health", "needs_you"] });
    const file = join(process.env.WORKSPACE_ROOT!, "state", "human-surface", "ui-views.jsonl");
    appendFileSync(file, JSON.stringify({ region: "landing", revision: 2, id: "landing@2", blocks: ["weather"], limits: {} }) + "\n");
    resetViewsForTest();
    expect(currentView("landing")).toMatchObject({ revision: 1, blocks: ["health", "needs_you"] });
  });

  test("must-fail: the surface advertises uiView_write and never uiView", () => {
    expect(DISCOVERY_SHAPES).toContain("uiView_write");
    expect(DISCOVERY_SHAPES as readonly string[]).not.toContain("uiView");
    expect(REGISTRATION_PAYLOAD.shapes as readonly string[]).not.toContain("uiView");
  });
});

describe("human_surface:ui_view names the view each region draws", () => {
  async function report() {
    const res = await impulsesRouter.request("/v2/impulses/resolve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pointer: { type: "human_surface:ui_view" } }),
    });
    return ((await res.json()) as any).body;
  }

  test("with nothing written, the report names the default", async () => {
    expect((await report()).views.landing).toMatchObject({ id: "landing@0", revision: 0, blocks: ["latest_run"], written_by: null, written_at: null });
  });

  test("must-fail: after a write and an undo, the report names each revision, its blocks, limits and writer", async () => {
    await write({ region: "landing", blocks: ["needs_you", "health"], limits: { needs_you: 3 } });
    const after = (await report()).views.landing;
    expect(after).toMatchObject({ id: "landing@1", revision: 1, blocks: ["needs_you", "health"], limits: { needs_you: 3 }, undo_of: null });
    expect(after.written_by).toBeTruthy();
    await write({ region: "landing", undo: true });
    expect((await report()).views.landing).toMatchObject({ id: "landing@2", revision: 2, blocks: ["latest_run"], undo_of: 0 });
  });
});
