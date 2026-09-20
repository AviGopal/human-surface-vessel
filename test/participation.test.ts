import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { impulsesRouter } from "../src/routes/impulses.ts";
import { participationRouter } from "../src/routes/participation.ts";
import { questionView, listPanels, recentFeedback, recordFeedback } from "../src/store.ts";

async function resolve(pointer: Record<string, unknown>) {
  return impulsesRouter.request("/v2/impulses/resolve", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pointer }),
  });
}
async function question(body: unknown = "What evidence is missing?", extras = {}) {
  const id = crypto.randomUUID();
  const response = await resolve({ type: "uiQuestion_write", id, title: "Review the evidence", body, ...extras });
  expect(response.status).toBe(200);
  return (await response.json()).body;
}
async function respond(panel: { id: string; revision: number }, value: unknown, extra = {}) {
  return participationRouter.request("/api/participation", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ panel_id: panel.id, panel_revision: panel.revision,
      response_id: crypto.randomUUID(), kind: "answer", value, ...extra }),
  });
}

describe("activity → question → browser contribution → activity read", () => {
  test("repeating an identical authored question does not invalidate a human's version", async () => {
    const panel = await question({ evidence: "unchanged" });
    const repeated = await resolve({ type: "uiQuestion_write", id: panel.id,
      title: panel.title, body: panel.body, kind: panel.kind, importance: panel.importance });
    expect((await repeated.json()).body.revision).toBe(panel.revision);
    expect((await respond(panel, "still applicable")).status).toBe(200);
  });

  test("question answers and retry identity survive the recent-feedback window", async () => {
    const panel = await question();
    const response_id = crypto.randomUUID();
    await respond(panel, "retained", { response_id });
    for (let i = 0; i < 501; i++) recordFeedback({ panelId: "other-question", kind: "answer", value: i });
    expect(recentFeedback(500).some(response => response.id === response_id)).toBe(false);
    expect(questionView(listPanels().find(p => p.id === panel.id)!).answered).toBe(true);
    const retried = await respond(panel, "retained", { response_id });
    expect((await retried.json()).body.id).toBe(response_id);
    expect(questionView(listPanels().find(p => p.id === panel.id)!).responses).toHaveLength(1);
  });
  test("retains structured content and false, zero, null answers without interpreting them", async () => {
    for (const value of [false, 0, null, { distinction: ["suspected", "established"], reference: { type: "artifact", id: "evidence-1" } }]) {
      const body = { evidence: [false, 0, null], unfamiliar: { nested: "<script>not executable</script>" } };
      const panel = await question(body);
      const response = await respond(panel, value);
      expect(response.status).toBe(200);
      const receipt = (await response.json()).body;
      expect(receipt.value).toEqual(value);
      const read = await resolve({ type: "uiQuestion", id: panel.id });
      const result = (await read.json()).body.questions[0];
      expect(result.body).toEqual(body);
      expect(result.answered).toBe(true);
      expect(result.answers[0].id).toBe(receipt.id);
      expect(result.answers[0].panelRevision).toBe(panel.revision);
    }
  });

  test("rejects stale answers, keeps old evidence separate, and accepts a new revision", async () => {
    const panel = await question();
    expect((await respond(panel, "initial answer")).status).toBe(200);
    const updated = await resolve({ type: "uiQuestion_write", id: panel.id, title: "Revised", body: "New evidence" });
    const revision = (await updated.json()).body;
    expect(revision.revision).toBe(panel.revision + 1);
    expect((await respond(panel, "stale answer")).status).toBe(409);
    const view = questionView(listPanels().find(p => p.id === panel.id)!);
    expect(view.answered).toBe(false);
    expect(view.responses).toHaveLength(1);
    expect((await respond(revision, "revised answer")).status).toBe(200);
  });

  test("retry of the same response is idempotent, even after the question changes", async () => {
    const panel = await question();
    const response_id = crypto.randomUUID();
    const first = await respond(panel, { answer: "supported" }, { response_id });
    const receipt = (await first.json()).body;
    await resolve({ type: "uiQuestion_write", id: panel.id, title: "Changed", body: "Another question" });
    const retry = await respond(panel, { answer: "supported" }, { response_id });
    expect(retry.status).toBe(200);
    expect((await retry.json()).body).toEqual(receipt);
    expect(recentFeedback(500).filter(f => f.id === response_id)).toHaveLength(1);
    expect((await respond(panel, "different", { response_id })).status).toBe(409);
  });

  test("partial answers, declines, and unknown parts remain distinguishable", async () => {
    const panel = await question("Review both", { asks: [
      { id: "cause", prompt: "Cause?", type: "text" }, { id: "fix", prompt: "Fix?", type: "text" },
    ] });
    expect((await respond(panel, "known", { ask_id: "cause" })).status).toBe(200);
    expect(questionView(listPanels().find(p => p.id === panel.id)!).answered).toBe(false);
    expect((await respond(panel, "unknown", { ask_id: "missing" })).status).toBe(409);
    expect((await respond(panel, "cannot assess", { kind: "dismiss" })).status).toBe(200);
    const view = questionView(listPanels().find(p => p.id === panel.id)!);
    expect(view.answered).toBe(false);
    expect(view.declined).toBe(true);
  });

  test("ordinary participation does not file a complaint or make a network request", async () => {
    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (() => { calls++; throw new Error("unexpected network call"); }) as typeof fetch;
    try {
      const panel = await question();
      expect((await respond(panel, "evidence")).status).toBe(200);
      expect((await respond(panel, "", { kind: "dismiss" })).status).toBe(200);
      expect(calls).toBe(0);
    } finally { globalThis.fetch = original; }
  });

  test("browser read uses the same question records as shaped resolution", async () => {
    const panel = await question();
    const response = await participationRouter.request("/api/questions");
    expect((await response.json()).body.questions.some((p: { id: string }) => p.id === panel.id)).toBe(true);
    const invalid = await participationRouter.request("/api/participation", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ panel_id: panel.id, value: 0 }),
    });
    expect(invalid.status).toBe(400);
  });

  test("restart restores the exact question, revision, and response identity", async () => {
    const panel = await question({ reference: "artifact-42" });
    const response_id = crypto.randomUUID();
    await respond(panel, { distinction: "unverified" }, { response_id });
    const module = new URL("../src/store.ts", import.meta.url).pathname;
    const child = Bun.spawnSync([process.execPath, "-e", `
      const store = await import(${JSON.stringify(module)});
      const panel = store.listPanels().find(p => p.id === ${JSON.stringify(panel.id)});
      console.log(JSON.stringify(store.questionView(panel)));
    `], { env: process.env });
    expect(child.exitCode).toBe(0);
    const restored = JSON.parse(child.stdout.toString());
    expect(restored.body).toEqual(panel.body);
    expect(restored.revision).toBe(panel.revision);
    expect(restored.answers[0].id).toBe(response_id);
    expect(restored.answers[0].value).toEqual({ distinction: "unverified" });
  });

  test("a journal write failure cannot acknowledge or expose an unrecorded panel", () => {
    const workspace = mkdtempSync(join(tmpdir(), "human-surface-unwritable-"));
    writeFileSync(join(workspace, "interactor-log"), "a file, not a directory");
    const module = new URL("../src/store.ts", import.meta.url).pathname;
    const child = Bun.spawnSync([process.execPath, "-e", `
      const store = await import(${JSON.stringify(module)});
      let failed = false;
      try { store.upsertPanel({ id: "never-stored", title: "q", body: {}, kind: "question", importance: "medium" }); }
      catch { failed = true; }
      if (!failed || store.listPanels().length) process.exit(1);
    `], { env: { ...process.env, WORKSPACE_ROOT: workspace } });
    rmSync(workspace, { recursive: true, force: true });
    expect(child.exitCode).toBe(0);
  });
});
