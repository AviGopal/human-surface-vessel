/**
 * A question waits on a person only when its writer declared the shape that takes the answer
 * and discovery lists that shape when the question is read. Nothing infers a reader from a
 * question's id or kind (surface-acts-on-shapes-present R.1).
 *
 * Shapes: one node 11-11. Fifty machine questions were offered under "Waiting on you"; none named
 * a reader, and the table that guessed one from the panel id pointed at a vessel that had left.
 *
 * Runs in a fresh subprocess against a disposable workspace, as honest-asks.test.ts does: the
 * discovery endpoint is read at import, and the shared test process holds other files' panels.
 */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const storeModule = new URL("../src/store.ts", import.meta.url).pathname;
const routerModule = new URL("../src/routes/impulses.ts", import.meta.url).pathname;

const SCENARIO = `
  let listing = true;
  const server = Bun.serve({ port: 0, async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/registry/shapes") return listing ? Response.json({ shapes: ["listed_reader"] }) : new Response("", { status: 503 });
    return Response.json({}, { status: 404 });
  } });
  process.env.DISCOVERY_ENDPOINT = "http://127.0.0.1:" + server.port;
  process.env.DISCOVERY_VESSEL_ENDPOINT = "http://127.0.0.1:" + server.port;
  await import(${JSON.stringify(storeModule)});
  const { impulsesRouter } = await import(${JSON.stringify(routerModule)});
  async function resolve(pointer) {
    const res = await impulsesRouter.request("/v2/impulses/resolve", {
      method: "POST", headers: { "content-type": "application/json", Authorization: "ApiKey " + process.env.METABOB_API_KEY },
      body: JSON.stringify({ pointer }),
    });
    return { status: res.status, body: (await res.json()).body };
  }
  await resolve({ type: "uiQuestion_write", id: "q-listed", title: "Which way?", body: "Pick one.", reader: "listed_reader" });
  await resolve({ type: "uiQuestion_write", id: "q-unlisted", title: "Which way?", body: "Pick one.", reader: "gone_reader" });
  // An id and kind the old table read as an escalation, with no reader declared.
  await resolve({ type: "uiQuestion_write", id: "needs-human-g1", title: "Gap needs a decision", body: "Gap g1 failed.", kind: "gap_needs_human" });
  // A later write that names no reader keeps the declared one.
  await resolve({ type: "uiQuestion_write", id: "q-listed", importance: "high" });
  const open = await resolve({ type: "uiQuestion", open: true });
  const whole = await resolve({ type: "uiQuestion" });
  listing = false;
  const dark = await resolve({ type: "uiQuestion", open: true });
  server.stop(true);
  console.log(JSON.stringify({ open: open.body, whole: whole.body, dark: dark.body }));
`;

function run(workspace: string) {
  const child = Bun.spawnSync([process.execPath, "-e", SCENARIO], { env: { ...process.env, WORKSPACE_ROOT: workspace } });
  return { exitCode: child.exitCode, stdout: child.stdout.toString(), stderr: child.stderr.toString() };
}

describe("a question waits on a person only when discovery lists its declared reader", () => {
  const workspace = mkdtempSync(join(tmpdir(), "human-surface-declared-reader-"));
  let out: ReturnType<typeof run>;
  let r: any = null;
  try {
    out = run(workspace);
    r = out.exitCode === 0 ? JSON.parse(out.stdout.trim().split("\n").pop()!) : null;
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }

  test("the scenario ran", () => {
    expect(out.stderr).toBe("");
    expect(out.exitCode).toBe(0);
  });

  test("must-fail: only the question whose declared reader is listed is offered as waiting", () => {
    expect(r.open.questions.map((q: any) => q.id)).toEqual(["q-listed"]);
    expect(r.open.questions[0].reader).toBe("listed_reader");
    expect(r.open.questions[0].readerListed).toBe(true);
  });

  test("must-fail: the rest are still served, each saying its reader was not confirmed, and counted", () => {
    const byId = new Map(r.whole.questions.map((q: any) => [q.id, q]));
    expect((byId.get("q-unlisted") as any)?.readerListed).toBe(false);
    expect((byId.get("needs-human-g1") as any)?.readerListed).toBe(false);
    expect((byId.get("needs-human-g1") as any)?.reader).toBeUndefined();
    expect(r.whole.readers).toEqual({ discovery: "answered", unlisted: 2 });
  });

  test("must-fail: when discovery does not answer, no reader is confirmed and the read says why", () => {
    expect(r.dark.questions).toEqual([]);
    expect(r.dark.readers).toEqual({ discovery: "unreachable", unlisted: 3 });
  });
});

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

test("must-fail: no source maps a question's id or kind to a reader", () => {
  const root = new URL("..", import.meta.url).pathname;
  const found = [...sources(join(root, "src")), ...sources(join(root, "ui/src"))].filter((f) =>
    /answerReaderFor|answersAreUnread|AnswerReader\b/.test(readFileSync(f, "utf8")),
  );
  expect(found).toEqual([]);
});
