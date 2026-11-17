/**
 * A region goes back to its default, or to any revision it drew, by a write: `default: true`
 * names the default as this surface defines it when read, so a later change to the default is
 * drawn; `restore: N` draws revision N again; undo steps back from what it restored, so undoing
 * twice goes back twice and never between the last two views.
 *
 * Shapes: on a live node a walk wrote a landing a person could not read; undo only moved
 * between that view and the one before it, and the one undo that reached the default stored a
 * copy of it, so the default's later changes were never drawn while any stored view was in force.
 */
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { forgetViews, testAuth } from "./setup.ts";
import { impulsesRouter } from "../src/routes/impulses.ts";
import { proxyRouter } from "../src/routes/proxy.ts";
import { DEFAULT_VIEWS, resetViewsForTest } from "../src/ui-views.ts";
import { viewLine } from "../ui/src/components/Landing";

const load = { pointer: { type: "record_read", shape: "system_load_report" }, form: "fields" };
const asked = { pointer: { type: "record_read", shape: "world_changed" }, form: "rows", show: 10, title: "Asked of me" };
const failed = { pointer: { type: "record_read", shape: "failure" }, form: "rows" };

async function write(pointer: Record<string, unknown>) {
  const res = await impulsesRouter.request("/v2/impulses/resolve", {
    method: "POST",
    headers: { "content-type": "application/json", ...testAuth() },
    body: JSON.stringify({ pointer: { type: "uiView_write", ...pointer } }),
  });
  return { status: res.status, json: (await res.json()) as any };
}

async function inForce() {
  return (await (await proxyRouter.request("/api/ui-view?region=landing")).json()) as any;
}

const lines = (): Record<string, unknown>[] =>
  readFileSync(join(process.env.WORKSPACE_ROOT ?? "/workspace", "state", "human-surface", "ui-views.jsonl"), "utf8")
    .split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));

beforeEach(forgetViews);
afterAll(forgetViews);

describe("back to the default", () => {
  test("must-fail: default: true draws the default, and its line names it without a copy of its entries", async () => {
    await write({ region: "landing", entries: [load, asked] });
    const back = await write({ region: "landing", default: true });
    expect(back.status).toBe(200);
    expect(back.json.body.view).toMatchObject({ revision: 2, isDefault: true, restoreOf: 0 });
    expect((await inForce()).entries).toEqual(DEFAULT_VIEWS.landing.entries);
    const stored = lines().at(-1)!;
    expect(stored).toMatchObject({ revision: 2, isDefault: true });
    expect("entries" in stored).toBe(false);
  });

  test("must-fail: a later change to the default is drawn where a revision names the default", async () => {
    await write({ region: "landing", entries: [load, asked] });
    await write({ region: "landing", default: true });
    const was = DEFAULT_VIEWS.landing.entries;
    (DEFAULT_VIEWS.landing as { entries: unknown }).entries = [load, failed];
    try {
      resetViewsForTest();
      expect(await inForce()).toMatchObject({ revision: 2, isDefault: true, entries: [load, failed] });
    } finally {
      (DEFAULT_VIEWS.landing as { entries: unknown }).entries = was;
      resetViewsForTest();
    }
  });

  test("must-fail: default over a stored copy of the default is a revision, since the copy stops following it", async () => {
    await write({ region: "landing", entries: [load] });
    expect((await write({ region: "landing", entries: [...DEFAULT_VIEWS.landing.entries] })).json.body.revision).toBe(2);
    const back = await write({ region: "landing", default: true });
    expect(back.json.body.unchanged).toBeUndefined();
    expect(back.json.body.view).toMatchObject({ revision: 3, isDefault: true });
    // Asked again, nothing changes.
    expect((await write({ region: "landing", default: true })).json.body).toMatchObject({ revision: 3, unchanged: true });
  });

  test("must-fail: default over a stored view that is refused today supersedes it", async () => {
    // A view with no entries is refused at load (one node holds one), so the default is drawn and the line named.
    const { appendFileSync, mkdirSync } = await import("node:fs");
    const dir = join(process.env.WORKSPACE_ROOT ?? "/workspace", "state", "human-surface");
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, "ui-views.jsonl"), JSON.stringify({ region: "landing", revision: 1, id: "landing@1", entries: [], note: null, writtenBy: null, run: null, writtenAt: 1, undoOf: null }) + "\n");
    resetViewsForTest();
    expect((await inForce()).notDrawn).toMatchObject({ id: "landing@1" });
    const back = await write({ region: "landing", default: true });
    expect(back.json.body.view).toMatchObject({ revision: 2, isDefault: true });
    expect((await inForce()).notDrawn).toBeNull();
  });

  test("the page names a return to the default as the usual layout", async () => {
    await write({ region: "landing", entries: [load, asked] });
    expect(viewLine(await inForce())).toBe("A rearranged layout.");
    await write({ region: "landing", default: true });
    expect(viewLine(await inForce())).toBe("My usual layout.");
  });

  test("must-fail: a stored view drawing just what the default draws is named the usual layout", async () => {
    // Undo after a return to the default can restore a copy of it: the page is the same, so is its line.
    await write({ region: "landing", entries: [load] });
    await write({ region: "landing", entries: [...DEFAULT_VIEWS.landing.entries] });
    await write({ region: "landing", default: true });
    expect((await write({ region: "landing", undo: true })).json.body.view).toMatchObject({ revision: 4, undoOf: 2 });
    const view = await inForce();
    expect(view).toMatchObject({ isDefault: false, drawsDefault: true });
    expect(viewLine(view)).toBe("My usual layout.");
  });
});

describe("restore a revision", () => {
  test("must-fail: restore: N draws revision N again as a new revision; restore: 0 is the default", async () => {
    await write({ region: "landing", entries: [load, asked] });
    await write({ region: "landing", entries: [load] });
    const r = await write({ region: "landing", restore: 1 });
    expect(r.json.body.view).toMatchObject({ revision: 3, entries: [load, asked], restoreOf: 1, undoOf: null });
    expect((await write({ region: "landing", restore: 0 })).json.body.view).toMatchObject({ revision: 4, isDefault: true, restoreOf: 0 });
    // Restoring a revision that named the default names it again, never a copy.
    await write({ region: "landing", entries: [load] });
    expect((await write({ region: "landing", restore: 4 })).json.body.view).toMatchObject({ revision: 6, isDefault: true });
    expect("entries" in lines().at(-1)!).toBe(false);
  });

  test("must-fail: a revision never drawn, or not a number, is refused and stores nothing", async () => {
    await write({ region: "landing", entries: [load] });
    for (const restore of [7, -1, 1.5, "1"]) {
      const r = await write({ region: "landing", restore });
      expect(r.status).toBe(422);
      expect(r.json.refusal).toBe("no_such_revision");
    }
    expect((await inForce()).revision).toBe(1);
  });

  test("must-fail: any two of entries, default, restore and undo are refused: a write is one of them", async () => {
    for (const both of [{ entries: [load], default: true }, { entries: [load], restore: 0 }, { entries: [load], undo: true }, { default: true, restore: 0 }, { default: true, undo: true }, { restore: 0, undo: true }]) {
      const r = await write({ region: "landing", ...both });
      expect(r.status).toBe(422);
      expect(r.json.refusal).toBe("bad_entry");
    }
    expect((await inForce()).revision).toBe(0);
  });
});

describe("undo steps back", () => {
  test("must-fail: undoing twice goes back twice, to the default at last, never between the last two", async () => {
    await write({ region: "landing", entries: [load, asked] });
    await write({ region: "landing", entries: [load] });
    await write({ region: "landing", entries: [load, failed] });
    expect((await write({ region: "landing", undo: true })).json.body.view).toMatchObject({ revision: 4, entries: [load], undoOf: 2 });
    expect((await write({ region: "landing", undo: true })).json.body.view).toMatchObject({ revision: 5, entries: [load, asked], undoOf: 1 });
    expect((await write({ region: "landing", undo: true })).json.body.view).toMatchObject({ revision: 6, isDefault: true, undoOf: 0 });
    expect((await write({ region: "landing", undo: true })).json.refusal).toBe("nothing_to_undo");
  });

  test("must-fail: undo after a return to the default restores the view it replaced", async () => {
    await write({ region: "landing", entries: [load, asked] });
    await write({ region: "landing", default: true });
    expect((await write({ region: "landing", undo: true })).json.body.view).toMatchObject({ revision: 3, entries: [load, asked], undoOf: 1 });
  });

  test("lines written before this change still load, their undo included", async () => {
    // As stored on a live node: an undo to the default kept a copy and named the revision it restored.
    const { appendFileSync, mkdirSync } = await import("node:fs");
    const dir = join(process.env.WORKSPACE_ROOT ?? "/workspace", "state", "human-surface");
    mkdirSync(dir, { recursive: true });
    const line = (revision: number, entries: unknown[], undoOf: number | null) =>
      JSON.stringify({ region: "landing", revision, id: `landing@${revision}`, entries, note: null, writtenBy: null, run: null, writtenAt: revision, undoOf }) + "\n";
    appendFileSync(join(dir, "ui-views.jsonl"), line(1, [load], null) + line(2, [...DEFAULT_VIEWS.landing.entries], 0) + line(3, [load, asked], null));
    resetViewsForTest();
    expect(await inForce()).toMatchObject({ revision: 3, entries: [load, asked] });
    // A line from before says it is no default and restored nothing, as a reader of the region's view reads it.
    const region = await impulsesRouter.request("/v2/impulses/resolve", {
      method: "POST",
      headers: { "content-type": "application/json", ...testAuth() },
      body: JSON.stringify({ pointer: { type: "human_surface:ui_view", region: "landing" } }),
    });
    expect(((await region.json()) as any).view).toMatchObject({ revision: 3, isDefault: false, restoreOf: null, drawsDefault: false });
    expect((await write({ region: "landing", undo: true })).json.body.view).toMatchObject({ revision: 4, undoOf: 2 });
    // The old copy is a stored view, not the default: going back to the default is still a revision.
    expect((await write({ region: "landing", default: true })).json.body.view).toMatchObject({ revision: 5, isDefault: true });
  });
});
