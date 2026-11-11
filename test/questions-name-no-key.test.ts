/**
 * Every read of the questions, answers and events names whoever asked or answered only to that
 * person, signed in (/api/questions, the uiQuestion read itself, /api/state, /api/stream):
 * an answer's `caller.label` and a question's `producer` are stamped from the writer's key label
 * (`key:<key id>`), and every other viewer is sent "a person" in their place. The stamp itself
 * keeps the key id (undo reads it). Through the real writer: identity is a stub that issues a key
 * id, the question and the answer are written under that key through the routes, and each read
 * is made signed out, as someone else, and as that person (a stream opened before the writes).
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
  const { app } = await import(${module("index.ts")});
  const { PORT } = await import(${module("config.ts")});
  const { DEFAULT_VIEWS } = await import(${module("ui-views.ts")});
  const cookie = (userId) => openSession({ apiKey: "test-only-key", userId, orgId: null, email: null, name: null, expiresAt: Date.now() + 900000 }).cookie.split(";")[0];
  // The person signs in with their key through the page's route, which records the sign-in.
  const here = "http://127.0.0.1:" + PORT;
  const signIn = await app.request(here + "/api/session/key", { method: "POST", headers: { "content-type": "application/json", Origin: here }, body: JSON.stringify({ key: PERSON_KEY }) });
  const viewers = { signedOut: undefined, other: cookie("key__test-other"), self: (signIn.headers.get("Set-Cookie") ?? "").split(";")[0] };
  const headers = (c) => (c ? { Cookie: c } : {});
  // Streams opened before the writes, one per viewer: what each is sent as they happen.
  const streams = Object.fromEntries(Object.entries(viewers).map(([k, c]) => [k, { ac: new AbortController(), c }]));
  const reading = Object.fromEntries(await Promise.all(Object.entries(streams).map(async ([k, s]) => {
    const res = await app.request("/api/stream", { headers: headers(s.c), signal: s.ac.signal });
    const reader = res.body.getReader();
    let text = "";
    const done = (async () => { try { for (;;) { const { value, done } = await reader.read(); if (done) break; text += new TextDecoder().decode(value); if (text.includes("feedback_received")) break; } } catch {} return text; })();
    return [k, done];
  })));
  const asPerson = { "content-type": "application/json", Authorization: "ApiKey " + PERSON_KEY };
  // The person asks and answers, under their own key, through the routes.
  const asked = await impulsesRouter.request("/v2/impulses/resolve", { method: "POST", headers: asPerson, body: JSON.stringify({ pointer: { type: "uiQuestion_write", id: "qnk-1", title: "Which way?", body: "Pick one." } }) });
  const revision = (await asked.json()).body.revision;
  // and changes what the ask page draws.
  const viewed = await impulsesRouter.request("/v2/impulses/resolve", { method: "POST", headers: asPerson, body: JSON.stringify({ pointer: { type: "uiView_write", region: "ask", entries: DEFAULT_VIEWS.ask.entries.slice(0, 1) } }) });
  const answered = await participationRouter.request("/api/participation", { method: "POST", headers: asPerson, body: JSON.stringify({ panel_id: "qnk-1", panel_revision: revision, response_id: "qnk-r1", kind: "answer", value: "left" }) });
  const timeout = (p) => Promise.race([p, new Promise((r) => setTimeout(() => r("timed out"), 3000))]);
  const reads = {};
  for (const [k, c] of Object.entries(viewers)) {
    reads[k] = {
      questions: await (await participationRouter.request("/api/questions", { headers: headers(c) })).text(),
      // The read itself, which answers without a caller.
      impulse: await (await impulsesRouter.request("/v2/impulses/resolve", { method: "POST", headers: { "content-type": "application/json", ...headers(c) }, body: JSON.stringify({ pointer: { type: "uiQuestion" } }) })).text(),
      state: await (await app.request("/api/state", { headers: headers(c) })).text(),
      view: await (await app.request("/api/ui-view?region=ask", { headers: headers(c) })).text(),
      uiView: await (await impulsesRouter.request("/v2/impulses/resolve", { method: "POST", headers: { "content-type": "application/json", ...headers(c) }, body: JSON.stringify({ pointer: { type: "human_surface:ui_view" } }) })).text(),
      stream: await timeout(reading[k]),
    };
    streams[k].ac.abort();
  }
  const out = { signedIn: signIn.status, asked: asked.status, viewed: viewed.status, answered: answered.status, ...reads };
  identity.stop(true);
  console.log(JSON.stringify(out));
`;

function run(workspace: string) {
  const child = Bun.spawnSync([process.execPath, "-e", SCENARIO], { env: { ...process.env, WORKSPACE_ROOT: workspace } });
  return { exitCode: child.exitCode, stdout: child.stdout.toString(), stderr: child.stderr.toString() };
}
const panelIn = (text: string): Record<string, any> => (JSON.parse(text).body.questions as Record<string, any>[]).find((q) => q.id === "qnk-1")!;
/** The question, answer and sign-in as /api/state serves them. */
const stateOf = (text: string) => {
  const s = JSON.parse(text);
  return { panel: s.panels.find((p: any) => p.id === "qnk-1"), answer: s.feedback.find((f: any) => f.panelId === "qnk-1"), signIn: s.observations.find((o: any) => o.type === "person_session") };
};
/** The data of each event the stream sent, by event name. */
const eventsOf = (text: string): Record<string, any> =>
  Object.fromEntries([...text.matchAll(/event: (\S+)\ndata: (.*)\n/g)].map((m) => [m[1], JSON.parse(m[2]!)]));

describe("every read of the questions and answers names a person only to themselves", () => {
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
    expect([r["signedIn"], r["asked"], r["viewed"], r["answered"]]).toEqual([200, 200, 200, 200]);
  });

  test("must-fail: signed out, no key id; the answer and question name a person", () => {
    expect(r["signedOut"].questions).not.toContain(KEY_ID);
    const panel = panelIn(r["signedOut"].questions);
    expect(panel.producer).toBe("a person");
    expect(panel.responses[0].caller.label).toBe("a person");
    expect(panel.responses[0].value).toBe("left");
  });

  test("must-fail: signed in as someone else, still no key id", () => {
    expect(r["other"].questions).not.toContain(KEY_ID);
    expect(panelIn(r["other"].questions).responses[0].caller.label).toBe("a person");
  });

  test("control: signed in as that person, their own stamps name them", () => {
    const panel = panelIn(r["self"].questions);
    expect(panel.producer).toBe(`key:${KEY_ID}`);
    expect(panel.responses[0].caller.label).toBe(`key:${KEY_ID}`);
  });

  test("must-fail: the uiQuestion read itself, which needs no caller, names a person to everyone else", () => {
    for (const v of ["signedOut", "other"]) {
      expect(r[v].impulse).not.toContain(KEY_ID);
      expect(panelIn(r[v].impulse).responses[0].caller.label).toBe("a person");
    }
    expect(panelIn(r["self"].impulse).producer).toBe(`key:${KEY_ID}`);
  });

  test("must-fail: /api/state names a person to everyone else, and the person to themselves", () => {
    for (const v of ["signedOut", "other"]) {
      expect(r[v].state).not.toContain(KEY_ID);
      const { panel, answer, signIn } = stateOf(r[v].state);
      expect([panel.producer, answer.caller.label, signIn.body.user_id]).toEqual(["a person", "a person", "a person"]);
    }
    const { panel, answer, signIn } = stateOf(r["self"].state);
    expect([panel.producer, answer.caller.label, signIn.body.user_id]).toEqual([`key:${KEY_ID}`, `key:${KEY_ID}`, KEY_ID]);
  });

  test("must-fail: a view the person wrote names them only to themselves, on the page's read and the shape read", () => {
    for (const v of ["signedOut", "other"]) {
      expect(r[v].view).not.toContain(KEY_ID);
      expect(JSON.parse(r[v].view).writtenBy).toBe("a person");
      expect(r[v].uiView).not.toContain(KEY_ID);
      expect(JSON.parse(r[v].uiView).body.views.ask.written_by).toBe("a person");
    }
    expect(JSON.parse(r["self"].view).writtenBy).toBe(`key:${KEY_ID}`);
    expect(JSON.parse(r["self"].uiView).body.views.ask.written_by).toBe(`key:${KEY_ID}`);
  });

  test("must-fail: /api/stream sends each viewer the events with a person named only to themselves", () => {
    for (const v of ["signedOut", "other"]) {
      expect(r[v].stream).not.toContain(KEY_ID);
      const e = eventsOf(r[v].stream);
      expect([e["panel_added"].producer, e["feedback_received"].caller.label]).toEqual(["a person", "a person"]);
    }
    const e = eventsOf(r["self"].stream);
    expect([e["panel_added"].producer, e["feedback_received"].caller.label]).toEqual([`key:${KEY_ID}`, `key:${KEY_ID}`]);
  });
});
