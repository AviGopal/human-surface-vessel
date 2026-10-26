/**
 * A new panel with nothing in it is refused, as a new empty question already is, and
 * the refusal is counted where a validator reads the surface. A new panel with
 * content, and any update to an existing panel, still write. Through the routes
 * alone, so at a build without the refusal it fails on what the route answers.
 *
 * Shape: one node 10-26: a satisfier's side-effect uiPanel_write created two empty
 * "Untitled" panels; 495 of the 8,254 panels in that node's journal were created
 * empty and never filled. No writer creates a panel empty and fills it later.
 */
import { describe, expect, test } from "bun:test";
import { testAuth } from "./setup.ts";
import { impulsesRouter } from "../src/routes/impulses.ts";
import { getPanel } from "../src/store.ts";

async function resolve(pointer: Record<string, unknown>, auth = true) {
  const r = await impulsesRouter.request("/v2/impulses/resolve", {
    method: "POST",
    headers: { "content-type": "application/json", ...(auth ? testAuth() : {}) },
    body: JSON.stringify({ pointer }),
  });
  return { status: r.status, json: (await r.json()) as any };
}
const refusedCount = async (): Promise<number | undefined> =>
  (await resolve({ type: "human_surface:ui_view" }, false)).json.body?.refused_empty_writes?.uiPanel_write;

describe("an empty new panel", () => {
  test("must-fail: a fresh id with no title, body or asks is refused, stores nothing, and is counted", async () => {
    const before = (await refusedCount()) ?? 0;
    const pointers = [{}, { title: "" }, { body: "   " }, { asks: [] }, { kind: "notice", importance: "normal" }];
    for (const [i, extra] of pointers.entries()) {
      const id = `epr-empty-${i}`;
      const r = await resolve({ type: "uiPanel_write", id, ...extra });
      expect(r.status).toBe(422);
      expect(r.json.error).toContain("empty panel refused");
      expect(getPanel(id)).toBeUndefined();
    }
    expect(await refusedCount()).toBe(before + pointers.length);
  });

  test("control: a fresh panel with content is written", async () => {
    const r = await resolve({ type: "uiPanel_write", id: "epr-with-body", kind: "notice", title: "Autonomy scope widened: repos/x", body: "widen of repos/x" });
    expect(r.status).toBe(200);
    expect(getPanel("epr-with-body")?.title).toBe("Autonomy scope widened: repos/x");
  });

  test("control: an existing panel still takes an update, including a visibility-only one", async () => {
    await resolve({ type: "uiPanel_write", id: "epr-existing", title: "First", body: "one" });
    const update = await resolve({ type: "uiPanel_write", id: "epr-existing", body: "two" });
    expect(update.status).toBe(200);
    expect(getPanel("epr-existing")?.body).toBe("two");
    const vis = await resolve({ type: "uiPanel_write", id: "epr-existing", visibility: "operator_only" });
    expect(vis.status).toBe(200);
    expect(getPanel("epr-existing")?.visibility).toBe("operator_only");
  });
});
