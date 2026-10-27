/**
 * The write door and the page's read for a region's view, through the routes alone:
 * nothing here imports the views module, so at a build without views it fails on
 * what the routes answer.
 */
import { describe, expect, test } from "bun:test";
import { testAuth } from "./setup.ts";
import { impulsesRouter } from "../src/routes/impulses.ts";
import { proxyRouter } from "../src/routes/proxy.ts";
import { REGISTRATION_PAYLOAD } from "../src/discovery-registration.ts";

async function write(pointer: Record<string, unknown>, auth = true) {
  const res = await impulsesRouter.request("/v2/impulses/resolve", {
    method: "POST",
    headers: { "content-type": "application/json", ...(auth ? testAuth() : {}) },
    body: JSON.stringify({ pointer: { type: "uiView_write", ...pointer } }),
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as any };
}
const read = async () => {
  const res = await proxyRouter.request("/api/ui-view?region=landing");
  return { status: res.status, json: (await res.json().catch(() => ({}))) as any };
};

describe("a region's view through the routes", () => {
  test("must-fail: a valid view is stored and the page reads it back", async () => {
    const before = await read();
    expect(before.status).toBe(200);
    const w = await write({ region: "landing", blocks: ["health", "needs_you"], limits: { needs_you: 3 } });
    expect(w.status).toBe(200);
    const after = await read();
    expect(after.json.revision).toBe(before.json.revision + 1);
    expect(after.json.blocks).toEqual(["health", "needs_you"]);
  });

  test("must-fail: an unknown region is refused by name and stores nothing", async () => {
    const before = await read();
    const w = await write({ region: "run", blocks: ["health"] });
    expect(w.status).toBe(422);
    expect(w.json.refusal).toBe("unknown_region");
    expect((await read()).json.revision).toBe(before.json.revision);
  });

  test("must-fail: the surface registers as serving uiView_write and never uiView", () => {
    expect(REGISTRATION_PAYLOAD.shapes as readonly string[]).toContain("uiView_write");
    expect(REGISTRATION_PAYLOAD.shapes as readonly string[]).not.toContain("uiView");
  });

  test("must-fail: the report ties a view to the run that wrote it, when the write names one", async () => {
    const report = async () => {
      const res = await impulsesRouter.request("/v2/impulses/resolve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pointer: { type: "human_surface:ui_view" } }),
      });
      return ((await res.json()) as any).body.views.landing;
    };
    await write({ region: "landing", blocks: ["needs_you", "changed", "health"], dispatch_id: "d-teach", execution_id: "exec-teach", template_id: "activity:view-landing" });
    expect((await report()).run).toEqual({ dispatch_id: "d-teach", execution_id: "exec-teach", template_id: "activity:view-landing" });
    await write({ region: "landing", blocks: ["health"] });
    expect((await report()).run).toBeNull();
  });

  test("must-fail: a write naming exactly the view in force succeeds as unchanged and writes no revision", async () => {
    await write({ region: "landing", blocks: ["changed", "needs_you"], limits: { needs_you: 4 } });
    const before = await read();
    const again = await write({ region: "landing", blocks: ["changed", "needs_you"], limits: { needs_you: 4 } });
    expect(again.status).toBe(200);
    expect(again.json).toMatchObject({ resolved: true, success: true, body: { unchanged: true, revision: before.json.revision } });
    expect((await read()).json.revision).toBe(before.json.revision);
  });

  test("control: a write that changes the view still gets a new revision", async () => {
    const before = await read();
    const changed = await write({ region: "landing", blocks: ["needs_you", "changed"], limits: { needs_you: 4 } });
    expect(changed.status).toBe(200);
    expect(changed.json.body.unchanged).toBeUndefined();
    expect((await read()).json.revision).toBe(before.json.revision + 1);
  });
});
