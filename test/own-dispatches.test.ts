/**
 * "Mine" is the runs this surface asked, from its own record, not the newest
 * 50 of everyone's runs. On 10-14 node1 ran 177 system runs in three hours;
 * the person's asks sat at position 188 of goal-host's listing and "Mine"
 * showed "None" while all 247 of them still existed.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
// Bun's own Request, kept before happy-dom replaces it: happy-dom's drops the forbidden Origin
// header, and the page's Origin is what the write gate admits a keyless browser ask by.
const NativeRequest = globalThis.Request;
const nativeFetch = globalThis.fetch;
GlobalRegistrator.register({ url: "http://127.0.0.1:28310/" });

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { forgetOwnDispatches, signedInCookie, testAuth, teardownDom, trackRoot } from "./setup.ts";
import { Hono } from "hono";
import {
  FINISHED_RECHECK_MS,
  dueForRead,
  listOwnDispatches,
  recordOwnDispatch,
  rememberState,
  resetOwnDispatchesForTest,
} from "../src/own-dispatches.ts";

// Upstream stands in for goal-host: a run accepts with a dispatch id; a walk read answers by id.
const walkStatus = new Map<string, { status: string; reached: boolean | null }>();
/** Runs goal-host says it no longer holds ("dispatch not found"), as it does once a run ages out. */
const goneIds = new Set<string>();
const systemRows = Array.from({ length: 50 }, (_, i) => ({
  dispatchId: `sys-${i}`, goal: "reconcile the trace store back under its configured cap", status: "failed", reached: false,
  operator: null, trigger: "run-goal", startedAt: Date.UTC(2026, 9, 14, 10, 0, 50 - i), learning: null, answerBody: null,
}));
let nextId = 0;
const upstreamTypes: string[] = [];
/** Every call that reached the stub standing in for goal-host and discovery, and the dispatch bodies it was sent. */
const upstreamCalls: string[] = [];
const dispatchBodies: Record<string, unknown>[] = [];
const fakeUpstream = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (!url.endsWith("/api/mine")) upstreamCalls.push(url);
  if (url.endsWith("/api/mine")) return readMine(personA);
  if (url.includes("/api/questions")) return new Response(JSON.stringify({ resolved: true, success: true, body: { questions: [] } }), { status: 200 });
  if (url.endsWith("/api/resolve")) {
    return new Response(JSON.stringify({ resolved: true, shape: "activeDispatches", body: { dispatches: systemRows } }), { status: 200 });
  }
  const body = JSON.parse(String(init?.body ?? "{}")) as { type?: string; dispatchId?: string; pointer?: { type?: string } };
  const type = body.type ?? body.pointer?.type ?? "";
  upstreamTypes.push(type);
  if (type === "vesselCapability") return new Response(JSON.stringify({ content: { vessels: [] } }), { status: 200 });
  if (type === "goalDispatchAsync") dispatchBodies.push(body as Record<string, unknown>);
  if (type === "goalDispatchAsync") return new Response(JSON.stringify({ dispatchId: `mine-${++nextId}`, status: "running" }), { status: 202 });
  if (type === "goalWalkState") {
    if (goneIds.has(body.dispatchId ?? "")) return new Response(JSON.stringify({ resolved: false, shape: "goalWalkState", error: "dispatch not found" }), { status: 404 });
    const s = walkStatus.get(body.dispatchId ?? "");
    return new Response(JSON.stringify(s ? { resolved: true, body: { dispatchId: body.dispatchId, ...s } } : { resolved: false }), { status: 200 });
  }
  if (type === "activeDispatches") return new Response(JSON.stringify({ resolved: true, body: { dispatches: [], nextOffset: null } }), { status: 200 });
  return new Response("{}", { status: 200 });
}) as typeof fetch;
// The asks this file records stay in the one process's record (test/setup.ts) unless removed here, and a later file
// that needs it empty (own-dispatches-backfill) never sees its backfill run; so does the fetch stub.
afterAll(async () => {
  globalThis.fetch = nativeFetch;
  await forgetOwnDispatches();
});
globalThis.fetch = fakeUpstream;

const { proxyRouter } = await import("../src/routes/proxy.ts");
const app = new Hono();
app.route("/", proxyRouter);

const own = "http://127.0.0.1:28310";
/** Mine as a signed-in person reads it. Bun's own Request: happy-dom's drops the Cookie header. */
const readMine = (cookie: string) => app.fetch(new NativeRequest(`${own}/api/mine`, { headers: { cookie } }));
/** The signed-in person asking from the page (asking needs one), and another person. */
const personA = await signedInCookie("user:person-a", "Person A");
const personB = await signedInCookie("user:person-b", "Person B");
/** The person's page: same-origin and keyless (src/inbound-auth.ts admits it as browser-unverified). */
const ask = (goal: string, operator: string) =>
  app.fetch(new NativeRequest(`${own}/api/run-goal`, { method: "POST", body: JSON.stringify({ goal, operator }), headers: { "content-type": "application/json", origin: own, cookie: personA } }));
/** A system caller: keyed, no Origin. */
const systemAsk = (goal: string, operator: string) =>
  app.request(`${own}/api/run-goal`, { method: "POST", body: JSON.stringify({ goal, operator }), headers: { "content-type": "application/json", ...testAuth() } });

beforeEach(() => {
  resetOwnDispatchesForTest();
});
afterAll(async () => {
  await teardownDom();
});

describe("the surface's own record", () => {
  test("a person's ask is recorded once; a system dispatch through the same route is not", async () => {
    const res = await ask("Who am I?", "human-surface");
    expect(res.status).toBeLessThan(300);
    // The record follows the admitted caller, not the body's operator: a keyed system
    // caller is not the person, whatever operator it names.
    await systemAsk("internal", "rhythm-conductor-drain");
    await systemAsk("claims to be the surface", "human-surface");
    const rows = listOwnDispatches(50);
    expect(rows.map((r) => r.goal)).toEqual(["Who am I?"]);
    expect(recordOwnDispatch(rows[0]!)).toBe(false);
  });

  test("survives a restart: the record is read back from its file", async () => {
    await ask("Where are we?", "human-surface");
    resetOwnDispatchesForTest();
    expect(listOwnDispatches(50).map((r) => r.goal)).toContain("Where are we?");
  });

  test("goal-host is read only for unknown, running, or stale finished runs, a few at a time", () => {
    const now = 1_000_000_000;
    const rows = ["a", "b", "c", "d"].map((id, i) => ({ dispatchId: id, goal: id, operator: "human-surface", startedAt: now - i }));
    rememberState("b", { status: "running", reached: null, executionId: null, checkedAt: now });
    rememberState("c", { status: "completed", reached: true, executionId: null, checkedAt: now });
    rememberState("d", { status: "failed", reached: false, executionId: null, checkedAt: now - FINISHED_RECHECK_MS });
    expect(dueForRead(rows, now)).toEqual(["a", "b", "d"]);
    expect(dueForRead(rows, now, 1)).toEqual(["a"]);
  });
});

describe("where the record lives", () => {
  test("must-fail: under state/, which a super-repo clone ignores, never a new top-level folder", async () => {
    const { existsSync } = await import("node:fs");
    const { join } = await import("node:path");
    await ask("placement", "human-surface");
    const root = process.env.WORKSPACE_ROOT!;
    expect(existsSync(join(root, "state", "human-surface", "own-dispatches.jsonl"))).toBe(true);
    expect(existsSync(join(root, "human-surface"))).toBe(false);
  });

  test("the first version's file is moved under state/ and its folder removed", async () => {
    const { existsSync, mkdirSync, writeFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const root = process.env.WORKSPACE_ROOT!;
    mkdirSync(join(root, "human-surface"), { recursive: true });
    writeFileSync(join(root, "human-surface", "own-dispatches.jsonl"), JSON.stringify({ dispatchId: "legacy-1", goal: "old ask", operator: "human-surface", startedAt: 1 }) + "\n");
    resetOwnDispatchesForTest();
    expect(listOwnDispatches(500).map((r) => r.dispatchId)).toContain("legacy-1");
    expect(existsSync(join(root, "human-surface"))).toBe(false);
  });
});

describe("/api/mine", () => {
  test("returns this surface's runs with the state goal-host reports; one it no longer knows is left out", async () => {
    const r1 = (await (await ask("What time is it in France?", "human-surface")).json()) as { dispatchId: string };
    const r2 = (await (await ask("forgotten", "human-surface")).json()) as { dispatchId: string };
    walkStatus.set(r1.dispatchId, { status: "failed", reached: false });
    const j = (await (await readMine(personA)).json()) as { body: { dispatches: Array<{ dispatchId: string; status: string; operator: string }> } };
    expect(j.body.dispatches.map((d) => d.dispatchId)).toEqual([r1.dispatchId]);
    expect(j.body.dispatches[0]?.status).toBe("failed");
    expect(j.body.dispatches[0]?.operator).toBe("human-surface");
    expect(j.body.dispatches.some((d) => d.dispatchId === r2.dispatchId)).toBe(false);
  });
});

describe("Mine is the signed-in person's", () => {
  type Row = { dispatchId: string; person: { userId: string; name: string | null } | null; own: boolean };
  const mineOf = async (cookie: string): Promise<Row[]> => ((await (await readMine(cookie)).json()) as { body: { dispatches: Row[] } }).body.dispatches;

  test("must-fail: an ask Person A sends is in Person A's Mine with Person A as its sender, and not in Person B's", async () => {
    const r = (await (await ask("Where is it raining?", "human-surface")).json()) as { dispatchId: string };
    walkStatus.set(r.dispatchId, { status: "completed", reached: true });
    const personAs = await mineOf(personA);
    expect(personAs.find((d) => d.dispatchId === r.dispatchId)).toMatchObject({ own: true, person: { userId: "user:person-a", name: "Person A" } });
    expect((await mineOf(personB)).some((d) => d.dispatchId === r.dispatchId)).toBe(false);
  });

  test("must-fail: signed out, an ask reaches nothing upstream and there is no Mine", async () => {
    const before = upstreamCalls.length;
    const res = await app.fetch(new NativeRequest(`${own}/api/run-goal`, { method: "POST", body: JSON.stringify({ goal: "Who am I?" }), headers: { "content-type": "application/json", origin: own } }));
    expect(res.status).toBe(401);
    expect(upstreamCalls.length).toBe(before);
    const none = (await (await app.fetch(new NativeRequest(`${own}/api/mine`))).json()) as { body: { dispatches: unknown[] } };
    expect(none.body.dispatches).toEqual([]);
  });
});

describe("who asked comes from the session", () => {
  type Row = { dispatchId: string; person: { userId: string; name: string | null } | null };
  const mineOf = async (cookie: string): Promise<Row[]> => ((await (await readMine(cookie)).json()) as { body: { dispatches: Row[] } }).body.dispatches;

  test("must-fail: a person named in the body is ignored: Mine and the sender are the signed-in person's, and nothing claimed is forwarded", async () => {
    const res = await app.fetch(new NativeRequest(`${own}/api/run-goal`, {
      method: "POST",
      body: JSON.stringify({ goal: "Is the trace store under its cap?", person: { userId: "user:person-c", name: "Person C" }, userId: "user:person-c" }),
      headers: { "content-type": "application/json", origin: own, cookie: personA },
    }));
    const { dispatchId } = (await res.json()) as { dispatchId: string };
    walkStatus.set(dispatchId, { status: "completed", reached: true });
    expect((await mineOf(personA)).find((d) => d.dispatchId === dispatchId)?.person).toEqual({ userId: "user:person-a", name: "Person A" });
    const sent = dispatchBodies.at(-1)!;
    expect(sent["person"]).toBeUndefined();
    expect(sent["userId"]).toBeUndefined();
    expect(sent["tags"]).toContain("person:user:person-a");
  });

  test("must-fail: a row recorded before asks carried a person is in no one's Mine", async () => {
    recordOwnDispatch({ dispatchId: "pre-1", goal: "Where are we?", operator: "human-surface", startedAt: Date.now() });
    rememberState("pre-1", { status: "completed", reached: true, executionId: null, checkedAt: Date.now() });
    expect((await mineOf(personA)).some((d) => d.dispatchId === "pre-1")).toBe(false);
    expect((await mineOf(personB)).some((d) => d.dispatchId === "pre-1")).toBe(false);
  });
});

describe("outcomes the surface keeps", () => {
  type Row = { dispatchId: string; status: string; reached: boolean | null };
  const mine = async (): Promise<Row[]> => ((await (await readMine(personA)).json()) as { body: { dispatches: Row[] } }).body.dispatches;

  test("must-fail: a finished run's outcome is read back after a restart, with goal-host unable to answer", async () => {
    const r = (await (await ask("Who am I?", "human-surface")).json()) as { dispatchId: string };
    walkStatus.set(r.dispatchId, { status: "completed", reached: true });
    expect((await mine()).find((d) => d.dispatchId === r.dispatchId)).toMatchObject({ status: "completed", reached: true });
    resetOwnDispatchesForTest();
    walkStatus.delete(r.dispatchId);
    expect((await mine()).find((d) => d.dispatchId === r.dispatchId)).toMatchObject({ status: "completed", reached: true });
  });

  test("must-fail: a run goal-host no longer holds is drawn as record gone, never as running", async () => {
    const running = (await (await ask("When is the next transfer window?", "human-surface")).json()) as { dispatchId: string };
    const finished = (await (await ask("What time is it in Bergen?", "human-surface")).json()) as { dispatchId: string };
    walkStatus.set(running.dispatchId, { status: "running", reached: null });
    walkStatus.set(finished.dispatchId, { status: "failed", reached: false });
    expect((await mine()).find((d) => d.dispatchId === running.dispatchId)?.status).toBe("running");
    goneIds.add(running.dispatchId);
    goneIds.add(finished.dispatchId);
    const after = await mine();
    expect(after.find((d) => d.dispatchId === running.dispatchId)?.status).toBe("gone");
    // A kept outcome outlives goal-host's record of the run.
    expect(after.find((d) => d.dispatchId === finished.dispatchId)).toMatchObject({ status: "failed", reached: false });
    // And "gone" survives a restart without asking goal-host again.
    resetOwnDispatchesForTest();
    goneIds.clear();
    expect((await mine()).find((d) => d.dispatchId === running.dispatchId)?.status).toBe("gone");
  });
});

describe("Mine on a busy node", () => {
  test("must-fail: with 50 newer system runs on the board, Mine still lists the person's run", async () => {
    const r = (await (await ask("What is happening today?", "human-surface")).json()) as { dispatchId: string };
    walkStatus.set(r.dispatchId, { status: "completed", reached: true });
    const uiSrc = new URL("../ui/src/", import.meta.url).pathname;
    const from = (spec: string): string => Bun.resolveSync(spec, uiSrc);
    const React = await import(from("react"));
    const { createRoot: rawCreateRoot } = await import(from("react-dom/client"));
    const createRoot = (...a: Parameters<typeof rawCreateRoot>) => trackRoot(rawCreateRoot(...a));
    const { act } = React;
    const { QueryClient, QueryClientProvider } = await import(from("@tanstack/react-query"));
    const { LiveControlsProvider } = await import("../ui/src/state/liveControls");
    const { QuestionsProvider } = await import("../ui/src/state/questions");
    const { RunsList } = await import("../ui/src/components/RunsList");
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const el = document.createElement("div");
    document.body.appendChild(el);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => {
      createRoot(el).render(
        React.createElement(QueryClientProvider, { client: qc },
          React.createElement(LiveControlsProvider, null,
            React.createElement(QuestionsProvider, null,
              React.createElement(RunsList, { selectedDispatchId: null, onSelect: () => {}, filter: "mine" })))),
      );
    });
    for (let i = 0; i < 4; i++) await act(async () => { await new Promise((res) => setTimeout(res, 40)); });
    const rows = [...el.querySelectorAll(".sf-run-row")].map((x) => x.getAttribute("data-dispatch-id"));
    expect(rows).toContain(r.dispatchId);
    expect(rows.some((id) => id?.startsWith("sys-"))).toBe(false);
  });
});
