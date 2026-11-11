/**
 * The questions read names whoever answered or asked a question only to that person, signed in:
 * an answer's `caller.label` and a question's `producer` are stamped from the writer's key label
 * (`key:<key id>`), and every other viewer is sent "a person" in their place. The stamp itself
 * keeps the key id (undo reads it). Through the real writer: identity is a stub that issues a key
 * id, the question and the answer are written under that key through the routes, and
 * /api/questions is read signed out, as someone else, and as that person.
 *
 * Shape: one node 11-11. After the records read stopped sending a person's key id
 * (agf_m1wjuqnt8og3), /api/questions was read for the same field: an answer's stamp carries it.
 *
 * Runs in a fresh subprocess against a disposable workspace, as declared-reader.test.ts does: the
 * read serves a ranked slice, and in the shared test process other files' unanswered questions
 * outrank this answered one.
 */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const KEY_ID = "key__test-person";
const module = (p: string) => JSON.stringify(new URL(`../src/${p}`, import.meta.url).pathname);

const SCENARIO = `
  const KEY_ID = ${JSON.stringify(KEY_ID)};
  const PERSON_KEY = "valid-test-person";
  const identity = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(req) {
    const body = await req.json().catch(() => ({}));
    if (body?.impulse?.pointer?.apiKey === PERSON_KEY) return Response.json({ success: true, data: { authenticated: true, keyId: KEY_ID, scopes: ["read", "write"] } });
    return Response.json({ success: false, error: "invalid" }, { status: 401 });
  } });
  process.env.IDENTITY_VESSEL_URL = "http://127.0.0.1:" + identity.port;
  const { impulsesRouter } = await import(${module("routes/impulses.ts")});
  const { participationRouter } = await import(${module("routes/participation.ts")});
  const { openSession } = await import(${module("person-session.ts")});
  const asPerson = { "content-type": "application/json", Authorization: "ApiKey " + PERSON_KEY };
  // The person asks and answers, under their own key, through the routes.
  const asked = await impulsesRouter.request("/v2/impulses/resolve", { method: "POST", headers: asPerson, body: JSON.stringify({ pointer: { type: "uiQuestion_write", id: "qnk-1", title: "Which way?", body: "Pick one." } }) });
  const revision = (await asked.json()).body.revision;
  const answered = await participationRouter.request("/api/participation", { method: "POST", headers: asPerson, body: JSON.stringify({ panel_id: "qnk-1", panel_revision: revision, response_id: "qnk-r1", kind: "answer", value: "left" }) });
  const cookie = (userId) => openSession({ apiKey: "test-only-key", userId, orgId: null, email: null, name: null, expiresAt: Date.now() + 900000 }).cookie.split(";")[0];
  const read = async (c) => (await participationRouter.request("/api/questions", { headers: c ? { Cookie: c } : {} })).text();
  const out = { asked: asked.status, answered: answered.status, signedOut: await read(), other: await read(cookie("key__test-other")), self: await read(cookie(KEY_ID)) };
  identity.stop(true);
  console.log(JSON.stringify(out));
`;

function run(workspace: string) {
  const child = Bun.spawnSync([process.execPath, "-e", SCENARIO], { env: { ...process.env, WORKSPACE_ROOT: workspace } });
  return { exitCode: child.exitCode, stdout: child.stdout.toString(), stderr: child.stderr.toString() };
}
const panelIn = (text: string): Record<string, any> => (JSON.parse(text).body.questions as Record<string, any>[]).find((q) => q.id === "qnk-1")!;

describe("the questions read names a person only to themselves", () => {
  const workspace = mkdtempSync(join(tmpdir(), "human-surface-questions-name-"));
  let out: ReturnType<typeof run>;
  let r: Record<string, any> = {};
  try {
    out = run(workspace);
    r = out.exitCode === 0 ? JSON.parse(out.stdout.trim().split("\n").pop()!) : {};
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }

  test("the scenario ran, and the writes went in under the person's key", () => {
    expect(out.exitCode).toBe(0);
    expect([r["asked"], r["answered"]]).toEqual([200, 200]);
  });

  test("must-fail: signed out, no key id; the answer and question name a person", () => {
    expect(r["signedOut"]).not.toContain(KEY_ID);
    const panel = panelIn(r["signedOut"]);
    expect(panel.producer).toBe("a person");
    expect(panel.responses[0].caller.label).toBe("a person");
    expect(panel.responses[0].value).toBe("left");
  });

  test("must-fail: signed in as someone else, still no key id", () => {
    expect(r["other"]).not.toContain(KEY_ID);
    expect(panelIn(r["other"]).responses[0].caller.label).toBe("a person");
  });

  test("control: signed in as that person, their own stamps name them", () => {
    const panel = panelIn(r["self"]);
    expect(panel.producer).toBe(`key:${KEY_ID}`);
    expect(panel.responses[0].caller.label).toBe(`key:${KEY_ID}`);
  });
});
