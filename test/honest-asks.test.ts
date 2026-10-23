/**
 * The questions read leads with what a person can act on, and a question whose
 * gap has closed is not presented as waiting.
 *
 * Shapes: two nodes 10-22. The read ranked every solicitation and cut the slice
 * BEFORE the rail folded the rows nobody can act on, so 30 of one node's 50 slots
 * went to rows the browser then hid (20 with no reader, 3 notices, 7 malformed),
 * leaving 20 asks shown and 93 not shown at all. And 14 of the 20
 * "Needs your decision" / "Fixes that keep failing" asks on one node (10 of 20 on
 * the other node) were about gaps already closed, all shown as waiting.
 *
 * Runs in a fresh subprocess against a disposable workspace, as
 * importance-ranking.test.ts does: the shared test process holds panels other
 * files seed, and the gap-status cache is process-global.
 */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FOLDED, classifyQuestion, gapIdForPanel } from "../src/question-class.ts";

const storeModule = new URL("../src/store.ts", import.meta.url).pathname;
const routerModule = new URL("../src/routes/impulses.ts", import.meta.url).pathname;

const SCENARIO = `
  // A gap store that answers by id: two gaps are closed, the rest open.
  const closed = new Set(["gap-closed-a", "gap-closed-b"]);
  const reads = [];
  const server = Bun.serve({ port: 0, async fetch(req) {
    const url = new URL(req.url);
    const body = await req.json().catch(() => ({}));
    const p = (body.impulse && body.impulse.pointer) || body.pointer || {};
    if (p.type === "vesselCapability") return Response.json({ content: { vessels: [] } });
    if (url.pathname === "/v2/impulses/resolve" && p.type === "substrateGap" && p.id) {
      reads.push(p.id);
      return Response.json({ body: { gaps: [{ id: p.id, status: closed.has(p.id) ? "closed" : "open" }] } });
    }
    return Response.json({}, { status: 404 });
  } });
  process.env.DEV_VESSEL_ENDPOINT = "http://127.0.0.1:" + server.port;
  process.env.DISCOVERY_ENDPOINT = "http://127.0.0.1:" + server.port;
  process.env.DISCOVERY_VESSEL_ENDPOINT = "http://127.0.0.1:" + server.port;

  const store = await import(${JSON.stringify(storeModule)});
  const { impulsesRouter } = await import(${JSON.stringify(routerModule)});
  const DAY = 86400000;
  const now = Date.now();
  // Old, unread verification asks that age and the unanswered boost push to the top,
  // two fresh escalations about open gaps, and two about closed gaps.
  for (let i = 0; i < 6; i++) store.upsertPanel({ id: "pending-verify-gap-old-" + i, title: "Gap landed but is unverified", body: "Gap gap-old-" + i + " had a single landing.", kind: "gap_pending_verification", importance: "medium", createdAt: now - (40 + i) * DAY });
  store.upsertPanel({ id: "needs-human-gap-open-a", title: "Gap needs a human decision", body: "Gap gap-open-a failed.", kind: "gap_needs_human", importance: "high", createdAt: now - 1 * DAY });
  store.upsertPanel({ id: "reland-needs-human-gap-open-b", title: "Gap re-lands", body: "Gap gap-open-b re-lands.", kind: "gap_reland_needs_human", importance: "high", createdAt: now - 2 * DAY });
  store.upsertPanel({ id: "needs-human-gap-closed-a", title: "Gap needs a human decision", body: "Gap gap-closed-a failed.", kind: "gap_needs_human", importance: "high", createdAt: now - 30 * DAY });
  store.upsertPanel({ id: "reland-needs-human-gap-closed-b", title: "Gap re-lands", body: "Gap gap-closed-b re-lands.", kind: "gap_reland_needs_human", importance: "high", createdAt: now - 30 * DAY });

  async function read(pointer) {
    const res = await impulsesRouter.request("/v2/impulses/resolve", {
      method: "POST", headers: { "content-type": "application/json", Authorization: "ApiKey " + process.env.METABOB_API_KEY },
      body: JSON.stringify({ pointer }),
    });
    return (await res.json()).body;
  }
  const first = await read({ type: "uiQuestion", visibleSliceSize: 3 });
  // The statuses are read in the background; the read never waits on the gap store.
  for (let i = 0; i < 50 && reads.length < 4; i++) await new Promise((r) => setTimeout(r, 20));
  await new Promise((r) => setTimeout(r, 50));
  const second = await read({ type: "uiQuestion", visibleSliceSize: 3 });
  const whole = await read({ type: "uiQuestion", visibleSliceSize: null });
  server.stop(true);
  console.log(JSON.stringify({ first, second, whole, reads }));
`;

function run(workspace: string) {
  const child = Bun.spawnSync([process.execPath, "-e", SCENARIO], { env: { ...process.env, WORKSPACE_ROOT: workspace } });
  return { exitCode: child.exitCode, stdout: child.stdout.toString(), stderr: child.stderr.toString() };
}

describe("the questions read is honest about what a person can act on", () => {
  const workspace = mkdtempSync(join(tmpdir(), "human-surface-honest-asks-"));
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
    expect(r).not.toBeNull();
  });

  test("must-fail: the slice is spent on asks first; rows nobody reads come after them", () => {
    const ids = r.first.questions.map((q: any) => q.id);
    // Six aged verification rows outrank the escalations on weight alone; none of them is an ask.
    expect(ids.slice(0, 3).every((id: string) => id.startsWith("needs-human-") || id.startsWith("reland-needs-human-"))).toBe(true);
    // Ranks are positions in what is served, so the rail's exposure records stay true.
    expect(r.first.questions.map((q: any) => q.rank)).toEqual([1, 2, 3]);
    // The whole set is still served, folded rows after the asks.
    const all = r.whole.questions.map((q: any) => q.id);
    expect(all.length).toBe(10);
    expect(all.findIndex((id: string) => id.startsWith("pending-verify-"))).toBe(4);
  });

  test("must-fail: a question whose gap has closed says so, and is not an ask", () => {
    const byId = new Map(r.second.questions.concat(r.whole.questions).map((q: any) => [q.id, q]));
    expect((byId.get("needs-human-gap-closed-a") as any)?.gapStatus).toBe("closed");
    expect((byId.get("reland-needs-human-gap-closed-b") as any)?.gapStatus).toBe("closed");
    expect((byId.get("needs-human-gap-open-a") as any)?.gapStatus).toBe("open");
    // Once known, the two open asks lead; the closed ones (which outrank them on age) fall behind them.
    expect(r.second.questions.slice(0, 2).map((q: any) => q.id).sort()).toEqual(["needs-human-gap-open-a", "reland-needs-human-gap-open-b"]);
    const all = r.whole.questions.map((q: any) => q.id);
    expect(all.indexOf("needs-human-gap-closed-a")).toBeGreaterThan(1);
    expect(all.indexOf("reland-needs-human-gap-closed-b")).toBeGreaterThan(1);
  });

  test("the first read does not wait on the gap store, and each gap is read once", () => {
    // The first read answered before any status was read: nothing is marked, and unknown is not closed.
    for (const q of r.first.questions) expect(q.gapStatus).toBeUndefined();
    expect(new Set(r.reads).size).toBe(r.reads.length);
  });
});

describe("the shared classification", () => {
  const q = (id: string, kind: string, gapStatus?: string | null) => ({ id, title: "t", kind, body: "b", ...(gapStatus !== undefined ? { gapStatus } : {}) });

  test("must-fail: a closed gap's question is folded as settled; an open or unknown one stays an ask", () => {
    expect(classifyQuestion(q("needs-human-x", "gap_needs_human", "closed"))).toBe("settled");
    expect(classifyQuestion(q("needs-human-x", "gap_needs_human", "open"))).toBe("ask");
    expect(classifyQuestion(q("needs-human-x", "gap_needs_human"))).toBe("ask");
    expect(classifyQuestion(q("needs-human-x", "gap_needs_human", null))).toBe("ask");
    // A verification ask about a closed gap reads as settled, not as "no reader".
    expect(classifyQuestion(q("pending-verify-x", "gap_pending_verification", "closed"))).toBe("settled");
    expect(FOLDED.map((f) => f.label)).toEqual(["Notices", "Gap closed", "No reader", "Malformed"]);
  });

  test("a panel's gap is read off the prefix its writer uses", () => {
    expect(gapIdForPanel("needs-human-route-edit-1")).toBe("route-edit-1");
    expect(gapIdForPanel("reland-needs-human-route-edit-1")).toBe("route-edit-1");
    expect(gapIdForPanel("pending-verify-route-edit-1")).toBe("route-edit-1");
    expect(gapIdForPanel("needs-localization-db_slow_2026-10-01T06")).toBe("db_slow_2026-10-01T06");
    expect(gapIdForPanel("solicitation-abc")).toBeNull();
    expect(gapIdForPanel("needs-human-")).toBeNull();
  });
});
