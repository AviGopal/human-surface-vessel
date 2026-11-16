/**
 * A view names reads only (VIEW_READS): the page resolves each entry's pointer under the signed-in
 * person's own key on every poll, so a view naming a shape a tool answers would run that tool as
 * the person. A name does not say whether a shape writes (a tool's output shape resolves to the
 * tool), so the check is a closed list, not a suffix, at write and again when a stored view loads.
 *
 * Shape: 49e5af7 refused only `_write` names. request 61005 asked for a view entry of type gitDiff,
 * which reaches local-tools' git diff in the live clone, not records' gitDiff rows; shellResult and
 * gitCommitResult passed the same check.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { forgetViews } from "./setup.ts";
import { REGISTRATION_PAYLOAD } from "../src/discovery-registration.ts";
import { SESSION_RESOLVES } from "../src/routes/proxy.ts";
import { currentView, resetViewsForTest, VIEW_READS, viewShapeDescriptions, writeView } from "../src/ui-views.ts";

beforeEach(forgetViews);

// Output-shape aliases and tool names, one not ending in Result (bash, gitDiff, fileContent).
const TOOLS = ["shellResult", "gitCommitResult", "gitDiff", "bash", "fileContent", "git_commit"];
const rows = (pointer: Record<string, unknown>) => ({ region: "landing", entries: [{ pointer, form: "rows" }] });

describe("a view names reads only", () => {
  test("must-fail: an entry naming a tool's shape is refused at write, with the read that serves rows", () => {
    for (const type of TOOLS) {
      const r = writeView(rows({ type, where: { tree: "1".repeat(40) } }), null);
      expect(r.ok).toBe(false);
      expect(r.ok ? "" : r.detail).toContain("rows of any shape come from record_read");
    }
    expect(writeView(rows({ type: "record_read", shape: "gitDiff", where: { tree: "1".repeat(40) } }), null).ok).toBe(true);
  });

  test("must-fail: a thread's pointer and a graded read are held to the same list", () => {
    const parent = (thread: unknown, graded?: unknown) => ({ region: "landing", entries: [{ pointer: { type: "record_read", shape: "world_changed" }, form: "rows", thread, ...(graded ? { judge: "outcome", graded } : {}) }] });
    for (const type of TOOLS) {
      expect(writeView(parent({ pointer: { type, refs_to: "$row" }, form: "rows" }), null).ok).toBe(false);
      expect(writeView(parent({ pointer: { type: "record_read", refs_to: "$row", shape: "answer" }, form: "rows" }, { pointer: { type, refs_to: "$row" } }), null).ok).toBe(false);
    }
  });

  test("must-fail: a stored view naming a tool's shape is passed over when it loads, and the default is drawn", async () => {
    await forgetViews();
    const file = join(process.env.WORKSPACE_ROOT!, "state", "human-surface", "ui-views.jsonl");
    mkdirSync(join(process.env.WORKSPACE_ROOT!, "state", "human-surface"), { recursive: true });
    for (const [i, type] of TOOLS.entries()) {
      appendFileSync(file, JSON.stringify({ region: "landing", revision: i + 1, id: `landing@${i + 1}`, entries: [{ pointer: { type }, form: "fields" }], note: null, writtenBy: null, run: null, writtenAt: 1, undoOf: null }) + "\n");
      resetViewsForTest();
      const v = currentView("landing");
      expect(v.revision).toBe(0);
      expect(v.notDrawn).toMatchObject({ id: `landing@${i + 1}`, refusal: "bad_entry" });
    }
  });

  test("must-fail: the lists are exactly these: a view reads records or the questions, a session also writes the person's own rows", () => {
    // Exact sets, not names that must be absent: any name added to either list is a change this test sees.
    expect([...VIEW_READS]).toEqual(["record_read", "uiQuestion"]);
    expect([...SESSION_RESOLVES].sort()).toEqual(["record_read", "record_write", "uiQuestion"]);
  });

  test("the declared inputs and the description name the same list, and every default entry is on it", () => {
    const schema = (REGISTRATION_PAYLOAD as unknown as { shape_inputs: Record<string, any> }).shape_inputs["uiView_write"];
    expect(schema.properties.entries.items.properties.pointer.properties.type.enum).toEqual([...VIEW_READS]);
    expect(viewShapeDescriptions().uiView_write).toContain(`one of ${VIEW_READS.join(", ")}`);
    for (const e of currentView("landing").entries) expect(VIEW_READS as readonly string[]).toContain(e.pointer.type);
  });
});
