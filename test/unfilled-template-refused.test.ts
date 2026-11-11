/**
 * A question or panel whose id, kind, title or importance is still a template placeholder
 * ("{{goal.id}}"), or a human_input whose solicitation_id or dispatch_id is, is refused by name
 * and stores nothing, and the refusal is counted where a validator reads the surface. The body
 * and brief are the writer's content and may quote a placeholder. A placeholder is what the asks
 * reader classes malformed: one predicate, so the door and the reader cannot drift.
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
import { malformedReason } from "../src/question-class.ts";

async function resolve(pointer: Record<string, unknown>, auth = true) {
  const r = await impulsesRouter.request("/v2/impulses/resolve", {
    method: "POST",
    headers: { "content-type": "application/json", ...(auth ? testAuth() : {}) },
    body: JSON.stringify({ pointer }),
  });
  return { status: r.status, json: (await r.json()) as any };
}
const refused = async (): Promise<{ uiPanel_write: number; uiQuestion_write: number; human_input: number } | undefined> =>
  (await resolve({ type: "human_surface:ui_view" }, false)).json.body?.refused_template_writes;

describe("a write still carrying a template placeholder", () => {
  test("must-fail: the live form is refused naming its first unfilled field, and stores nothing", async () => {
    // An id of this file's own: the shared store may already hold the live "{{goal.id}}".
    const r = await resolve({ type: "uiQuestion_write", id: "{{utr.goal.id}}", kind: "{{goal.kind}}", title: "{{goal.title}}", body: '{"goal":"investigate"}' });
    expect(r.status).toBe(422);
    expect(r.json.error).toContain("unfilled template refused");
    expect(r.json.error).toContain('id is "{{utr.goal.id}}"');
    expect(getPanel("{{utr.goal.id}}")).toBeUndefined();
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

  test("must-fail: human_input with an unfilled solicitation_id or dispatch_id is refused, counted, and stores nothing", async () => {
    const before = (await refused())?.human_input ?? 0;
    const sol = await resolve({ type: "human_input", solicitation_id: "{{utr.solicitation}}", brief: "# Which way?\nPick one." });
    expect(sol.status).toBe(422);
    expect(sol.json.error).toContain('solicitation_id is "{{utr.solicitation}}"');
    expect(getPanel("solicitation-{{utr.solicitation}}")).toBeUndefined();
    const disp = await resolve({ type: "human_input", solicitation_id: "utr-sol-1", dispatch_id: "{{dispatch.id}}", brief: "Which way?" });
    expect(disp.status).toBe(422);
    expect(disp.json.error).toContain('dispatch_id is "{{dispatch.id}}"');
    expect(getPanel("solicitation-utr-sol-1")).toBeUndefined();
    expect((await refused())?.human_input).toBe(before + 2);
    // A brief quoting a placeholder is content.
    const ok = await resolve({ type: "human_input", solicitation_id: "utr-sol-2", brief: "Why did {{goal.id}} reach you?" });
    expect(ok.status).toBe(200);
  });

  test("must-fail: what the doors refuse is what the asks reader classes malformed", async () => {
    for (const id of ["{{utr.one}}", "{{ utr.two }}", "utr {{a b}} three"]) {
      expect(malformedReason({ id, title: "t", body: "b" } as never)).toBe("unrendered_template");
      expect((await resolve({ type: "uiQuestion_write", id, title: "Which way?" })).status).toBe(422);
      expect(getPanel(id)).toBeUndefined();
    }
  });

  test("control: a body may quote a placeholder, and braces that are not one are text", async () => {
    const quoted = await resolve({ type: "uiQuestion_write", id: "utr-body", title: "Why does {x} stay?", body: "The template wrote {{goal.id}} literally." });
    expect(quoted.status).toBe(200);
    expect(getPanel("utr-body")?.body).toBe("The template wrote {{goal.id}} literally.");
  });
});
