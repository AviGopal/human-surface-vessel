/**
 * A question or panel whose id, kind, title or importance is still a template placeholder
 * ("{{goal.id}}") is refused by name and stores nothing, and the refusal is counted where a
 * validator reads the surface. The body is the writer's content and may quote a placeholder.
 * Through the routes alone, so at a build without the refusal it fails on what the route answers.
 *
 * Shape: one node 11-11. A writer whose goal bindings never resolved stored a uiQuestion with id
 * "{{goal.id}}", kind "{{goal.kind}}" and title "{{goal.title}}"; the rail ranked it first, and
 * any later write with the same unfilled id would have landed on the same row.
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
const refused = async (): Promise<{ uiPanel_write: number; uiQuestion_write: number } | undefined> =>
  (await resolve({ type: "human_surface:ui_view" }, false)).json.body?.refused_template_writes;

describe("a write still carrying a template placeholder", () => {
  test("must-fail: the live form is refused naming its first unfilled field, and stores nothing", async () => {
    const r = await resolve({ type: "uiQuestion_write", id: "{{goal.id}}", kind: "{{goal.kind}}", title: "{{goal.title}}", body: '{"goal":"investigate"}' });
    expect(r.status).toBe(422);
    expect(r.json.error).toContain("unfilled template refused");
    expect(r.json.error).toContain('id is "{{goal.id}}"');
    expect(getPanel("{{goal.id}}")).toBeUndefined();
  });

  test("must-fail: each naming field is checked, on questions and panels, and each refusal is counted", async () => {
    const before = (await refused()) ?? { uiPanel_write: 0, uiQuestion_write: 0 };
    const cases: [string, Record<string, unknown>, string][] = [
      ["uiQuestion_write", { id: "utr-kind", kind: "{{ goal.kind }}", title: "Which way?" }, "kind"],
      ["uiQuestion_write", { id: "utr-title", title: "{{goal.title}}", body: "Pick one." }, "title"],
      ["uiQuestion_write", { id: "utr-importance", title: "Which way?", importance: "{{goal.importance}}" }, "importance"],
      ["uiPanel_write", { id: "utr-panel", title: "Run {{run.id}} finished", body: "done" }, "title"],
    ];
    for (const [type, extra, field] of cases) {
      const r = await resolve({ type, ...extra });
      expect(r.status).toBe(422);
      expect(r.json.error).toContain(`${field} is "`);
      expect(getPanel(String(extra["id"]))).toBeUndefined();
    }
    expect(await refused()).toMatchObject({ uiQuestion_write: before.uiQuestion_write + 3, uiPanel_write: before.uiPanel_write + 1 });
  });

  test("must-fail: an update that would write a placeholder over a filled field changes nothing", async () => {
    await resolve({ type: "uiQuestion_write", id: "utr-existing", title: "Which way?", body: "Pick one." });
    const r = await resolve({ type: "uiQuestion_write", id: "utr-existing", title: "{{goal.title}}" });
    expect(r.status).toBe(422);
    expect(getPanel("utr-existing")?.title).toBe("Which way?");
  });

  test("control: a body may quote a placeholder, and braces that are not one are text", async () => {
    const quoted = await resolve({ type: "uiQuestion_write", id: "utr-body", title: "Why does {x} stay?", body: "The template wrote {{goal.id}} literally." });
    expect(quoted.status).toBe(200);
    expect(getPanel("utr-body")?.body).toBe("The template wrote {{goal.id}} literally.");
  });
});
