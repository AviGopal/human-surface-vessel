/**
 * A region's view is written through `uiView_write`, checked against a closed
 * vocabulary, kept per region with a revision log, and read by the page at use
 * time. A view is a list of entries, each a pointer and the form its answer is drawn
 * in; no section is named. A refusal names its reason and stores nothing; "undo"
 * restores the view in force before; the views survive a restart, and a stored view
 * refused today is named as passed over, not silently skipped. The surface serves
 * `uiView_write` and never advertises `uiView`, so a learned activity that writes views
 * is that shape's only producer and is not refused as a duplicate of the surface.
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

const load = { pointer: { type: "system_load_report" }, form: "fields" };
const asked = { pointer: { type: "record_read", shape: "world_changed" }, form: "rows", show: 10, title: "What people asked" };

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
  test("with nothing written, the landing draws its default per job: what waits on a person, their asks, one health line, then the raw reads folded", async () => {
    const r = await read("landing");
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ region: "landing", revision: 0, id: "landing@0", notDrawn: null });
    expect(r.json.entries.map((e: any) => [e.pointer.type, e.pointer.shape ?? null])).toEqual([
      ["uiQuestion", null],
      ["record_read", "world_changed"],
      ["record_read", "health"],
      ["record_read", "answer"],
      ["record_read", "failure"],
      ["record_read", "outcome"],
    ]);
    expect(r.json.entries.map((e: any) => e.folded === true)).toEqual([false, false, false, true, true, true]);
    expect(r.json.entries[1]).toMatchObject({ newest: true, thread: { newest: true } });
    expect(r.json.entries[2]).toMatchObject({ show: 1, empty: "Nothing reports health yet." });
  });

  test("must-fail: a valid view is stored, advances the revision, names its writer, and the page reads it", async () => {
    const w = await write({ region: "landing", entries: [load, asked] });
    expect(w.status).toBe(200);
    expect(w.json).toMatchObject({ resolved: true, shape: "uiView_write", body: { region: "landing", revision: 1 } });
    expect(w.json.body.view.writtenBy).toBeTruthy();
    const r = await read("landing");
    expect(r.json).toMatchObject({ revision: 1, id: "landing@1", entries: [load, asked] });
  });

  test("must-fail: each refusal is named, answers 422, and stores nothing", async () => {
    const cases: [Record<string, unknown>, string, string][] = [
      [{ region: "run", entries: [load] }, "unknown_region", "regions"],
      // The earlier form is refused by name, so its writer learns the form in force.
      [{ region: "landing", blocks: ["needs_you"] }, "unknown_field", "blocks: a view is {region, entries"],
      [{ region: "landing", entries: [load], reports: [{ type: "system_load_report" }] }, "unknown_field", "reports"],
      [{ region: "landing", entries: [load], limits: {} }, "unknown_field", "limits"],
      [{ region: "landing", entries: [] }, "bad_entry", "entries: 1 to 8"],
      [{ region: "landing", entries: Array.from({ length: 9 }, (_, i) => ({ pointer: { type: `r${i}` }, form: "fields" })) }, "bad_entry", "entries: 1 to 8"],
      [{ region: "landing", entries: [{ pointer: { type: "substrateGap_write" }, form: "rows" }] }, "bad_entry", "a view only reads"],
      [{ region: "landing", entries: [{ type: "system_load_report" }] }, "bad_entry", "pointer, form, title"],
      [{ region: "landing", entries: ["system_load_report"] }, "bad_entry", "{pointer, form}"],
      [{ region: "landing", entries: [{ pointer: { limit: 3 }, form: "fields" }] }, "bad_entry", "type"],
      [{ region: "landing", entries: [{ pointer: { type: "x", where: { a: 1 } }, form: "fields" }] }, "bad_entry", "plain values"],
      [{ region: "landing", entries: [{ pointer: { type: "x" } }] }, "bad_entry", "form: fields, rows, questions"],
      [{ region: "landing", entries: [{ pointer: { type: "x" }, form: "table" }] }, "bad_entry", "form: fields, rows, questions"],
      [{ region: "landing", entries: [{ pointer: { type: "x" }, form: "fields", judge: "outcome" }] }, "bad_entry", "judge needs form"],
      [{ region: "landing", entries: [{ pointer: { type: "x" }, form: "rows", judge: "label" }] }, "bad_entry", 'judge: "outcome"'],
      [{ region: "landing", entries: [{ pointer: { type: "x" }, form: "rows", show: 0 }] }, "bad_entry", "show: 1..200"],
      [{ region: "landing", entries: [{ pointer: { type: "x" }, form: "rows", field: "a b" }] }, "bad_entry", "field"],
      [{ region: "landing", entries: [{ pointer: { type: "x" }, form: "rows", title: "" }] }, "bad_entry", "title"],
      [{ region: "landing", entries: [{ pointer: { type: "x" }, form: "rows", empty: " " }] }, "bad_entry", "empty: 1 to 160"],
      [{ region: "landing", entries: [{ pointer: { type: "x" }, form: "rows", empty: 3 }] }, "bad_entry", "empty: 1 to 160"],
      [{ region: "landing", entries: [{ pointer: { type: "x" }, form: "rows", colour: "red" }] }, "bad_entry", "colour"],
      [{ region: "landing", entries: [{ pointer: { type: "x" }, form: "rows", words: [] }] }, "bad_entry", "words: 1 to 4 field names"],
      [{ region: "landing", entries: [{ pointer: { type: "x" }, form: "rows", words: "what" }] }, "bad_entry", "words: 1 to 4 field names"],
      [{ region: "landing", entries: [{ pointer: { type: "x" }, form: "rows", words: ["a", "b", "c", "d", "e"] }] }, "bad_entry", "words: 1 to 4 field names"],
      [{ region: "landing", entries: [{ pointer: { type: "x" }, form: "rows", words: ["what", "what"] }] }, "bad_entry", "words: 1 to 4 field names"],
      [{ region: "landing", entries: [{ pointer: { type: "x" }, form: "rows", words: ["a b"] }] }, "bad_entry", "words: 1 to 4 field names"],
      [{ region: "landing", entries: [{ pointer: { type: "x" }, form: "fields", words: ["what"] }] }, "bad_entry", "words needs form"],
      [{ region: "landing", entries: [{ pointer: { type: "x", refs_to: "$row" }, form: "rows" }] }, "bad_entry", "$row: only a thread's pointer"],
      [{ region: "landing", entries: [{ pointer: { type: "x" }, form: "rows", thread: { pointer: { type: "y" }, form: "rows" } }] }, "bad_entry", 'thread: its pointer names "$row"'],
      [{ region: "landing", entries: [{ pointer: { type: "x" }, form: "rows", thread: { pointer: { type: "y", refs_to: "$row" }, form: "rows", thread: { pointer: { type: "z", refs_to: "$row" }, form: "rows" } } }] }, "bad_entry", "thread: one level only"],
      [{ region: "landing", entries: [{ pointer: { type: "x" }, form: "fields", thread: { pointer: { type: "y", refs_to: "$row" }, form: "rows" } }] }, "bad_entry", "thread needs form"],
      [{ region: "landing", entries: [{ pointer: { type: "x" }, form: "rows", thread: { pointer: { type: "y", refs_to: "$row" }, form: "rows", colour: "red" } }] }, "bad_entry", "colour"],
      [{ region: "landing", entries: [{ pointer: { type: "x" }, form: "rows", newest: "yes" }] }, "bad_entry", "newest: true"],
      [{ region: "landing", entries: [{ pointer: { type: "x" }, form: "fields", newest: true }] }, "bad_entry", "newest needs form"],
      [{ region: "landing", entries: [{ pointer: { type: "x" }, form: "rows", folded: 1 }] }, "bad_entry", "folded: true"],
      [{ region: "landing", entries: [load, { ...load, form: "rows" }] }, "bad_entry", "named twice"],
    ];
    for (const [pointer, refusal, why] of cases) {
      const w = await write(pointer);
      expect(w.status).toBe(422);
      expect(w.json.refusal).toBe(refusal);
      expect(w.json.error).toContain(why);
    }
    expect((await read("landing")).json.revision).toBe(0);
  });

  test("must-fail: a write with no caller is refused and stores nothing", async () => {
    const w = await write({ region: "landing", entries: [load] }, false);
    expect(w.status).toBe(401);
    expect((await read("landing")).json.revision).toBe(0);
  });

  test("must-fail: undo restores the view in force before, as a new revision; undoing the first restores the default", async () => {
    expect((await write({ region: "landing", undo: true })).json.refusal).toBe("nothing_to_undo");
    await write({ region: "landing", entries: [load, asked] });
    await write({ region: "landing", entries: [load] });
    const u1 = await write({ region: "landing", undo: true });
    expect(u1.json.body.view).toMatchObject({ revision: 3, entries: [load, asked], undoOf: 1 });
    const u2 = await write({ region: "landing", undo: true });
    expect(u2.json.body.view).toMatchObject({ revision: 4, entries: [load], undoOf: 2 });
    await forgetViews();
    await write({ region: "landing", entries: [load] });
    const u3 = await write({ region: "landing", undo: true });
    expect(u3.json.body.view).toMatchObject({ revision: 2, undoOf: 0 });
    expect(u3.json.body.view.entries.length).toBe(6);
  });

  test("must-fail: an identical view is unchanged, whatever its note, and writes no revision", async () => {
    await write({ region: "landing", entries: [load, asked] });
    const same = await write({ region: "landing", entries: [load, asked], note: "a different note" });
    expect(same.status).toBe(200);
    expect(same.json.body).toMatchObject({ unchanged: true, revision: 1 });
    const reordered = await write({ region: "landing", entries: [asked, load] });
    expect(reordered.json.body).toMatchObject({ revision: 2 });
    expect(reordered.json.body.unchanged).toBeUndefined();
    const reshown = await write({ region: "landing", entries: [{ ...asked, show: 5 }, load] });
    expect(reshown.json.body.revision).toBe(3);
    await forgetViews();
    expect((await write({ region: "landing", entries: currentView("landing").entries })).json.body).toMatchObject({ unchanged: true, revision: 0 });
  });

  test("must-fail: views survive a restart, and a newer stored view refused today is passed over by name", async () => {
    await write({ region: "landing", entries: [load, asked] });
    const file = join(process.env.WORKSPACE_ROOT!, "state", "human-surface", "ui-views.jsonl");
    // A view in the earlier form, as one node holds it (landing@2, blocks ["needs_you"]).
    appendFileSync(file, JSON.stringify({ region: "landing", revision: 2, id: "landing@2", blocks: ["needs_you"], limits: {}, reports: [] }) + "\n");
    resetViewsForTest();
    const v = currentView("landing");
    expect(v).toMatchObject({ revision: 1, entries: [load, asked] });
    expect(v.notDrawn).toMatchObject({ id: "landing@2", refusal: "unknown_field" });
    expect(v.notDrawn!.detail).toContain("blocks");
    // The next write goes past every stored line, drawn or not, and clears the notice.
    const w = await write({ region: "landing", entries: [load] });
    expect(w.json.body.revision).toBe(3);
    expect(currentView("landing").notDrawn).toBeNull();
  });

  test("must-fail: a view whose only stored revision is refused today draws the default and says so", async () => {
    const file = join(process.env.WORKSPACE_ROOT!, "state", "human-surface", "ui-views.jsonl");
    await write({ region: "landing", entries: [load] });
    await forgetViews();
    appendFileSync(file, JSON.stringify({ region: "landing", revision: 2, id: "landing@2", blocks: ["needs_you"], limits: {}, reports: [] }) + "\n");
    resetViewsForTest();
    const r = await read("landing");
    expect(r.json).toMatchObject({ revision: 0, id: "landing@0", notDrawn: { id: "landing@2", refusal: "unknown_field" } });
  });

  test("must-fail: an entry is stored as written, and only its pointer is a pointer", async () => {
    const entry = { pointer: { type: "record_read", shape: "answer" }, form: "rows", judge: "outcome", show: 10, title: "What the walk answered", empty: "The walk has answered nothing yet.", words: ["text"], thread: { pointer: { type: "record_read", refs_to: "$row" }, form: "rows", show: 2, newest: true }, newest: true, folded: true };
    const w = await write({ region: "landing", entries: [entry, load] });
    expect(w.json.body.view.entries).toEqual([entry, load]);
  });

  test("must-fail: the ask region is written and read back like any region; its default reads what cites the ask", async () => {
    expect((await read("ask")).json).toMatchObject({ revision: 0, entries: [{ pointer: { type: "record_read", refs_to: "$ask" }, empty: "No row cites your ask yet." }] });
    const entry = { pointer: { type: "record_read", shape: "answer", refs_to: "$ask" }, form: "rows", title: "Answers to it", empty: "Not answered yet." };
    expect((await write({ region: "ask", entries: [entry] })).status).toBe(200);
    expect((await read("ask")).json).toMatchObject({ revision: 1, entries: [entry] });
    expect((await read("landing")).json.revision).toBe(0);
  });

  test("must-fail: the default view's pointers only read: none is a write, a tick or a scan", () => {
    for (const e of currentView("landing").entries) expect(e.pointer.type).not.toMatch(/_write$|tick|scan|observer/);
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
    expect((await report()).views.landing).toMatchObject({ id: "landing@0", revision: 0, written_by: null, written_at: null, not_drawn: null });
    expect((await report()).views.landing.entries.length).toBe(6);
  });

  test("must-fail: after a write and an undo, the report names each revision, its entries and writer", async () => {
    await write({ region: "landing", entries: [load] });
    const after = (await report()).views.landing;
    expect(after).toMatchObject({ id: "landing@1", revision: 1, entries: [load], undo_of: null });
    expect(after.written_by).toBeTruthy();
    await write({ region: "landing", undo: true });
    expect((await report()).views.landing).toMatchObject({ id: "landing@2", revision: 2, undo_of: 0 });
  });
});
