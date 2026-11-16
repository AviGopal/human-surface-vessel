/**
 * A thread is bound to its row by the row's id ("$row") or by a field of it ("$row.<field>", an
 * argument or a where value), so a thread can read what shares a value with its row as well as
 * what cites it: under a change, every verdict on its tree, whichever diff of that tree it cites.
 * A row without the field draws no thread and sends no read. The binding goes through the same
 * write check as any pointer: a view reads through records or the questions only.
 *
 * Rows are in the forms records holds on one node 11-16: the walk's gitDiff and land_verdicts carry
 * `repo` and `tree` at the top level.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://surface.test/" });

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { teardownDom, trackRoot } from "./setup.ts";
import { bindRow, boundToRow } from "../src/row-binding.ts";
import { resetViewsForTest, writeView } from "../src/ui-views.ts";

const TREE = "3".repeat(40);
const DIFF = { input_refs: ["a".repeat(64)], shape: "gitDiff", role: "walk", repo: "box-vessel", tree: TREE, diff: "", truncated: false, seq: 12, t: "2026-11-15T11:05:00.000Z", id: "b".repeat(64) };
const VERDICT = { input_refs: ["e".repeat(64)], shape: "land_verdict", role: "described", repo: DIFF.repo, tree: TREE, r: 1, why: "Same tree, another diff.", seq: 14, t: "2026-11-15T11:07:00.000Z", id: "c".repeat(64) };

const byTree = { pointer: { type: "record_read", shape: "land_verdict", where: { tree: "$row.tree" } }, form: "rows", show: 1, words: ["why"] } as const;
const changes = (thread: unknown) => ({ pointer: { type: "record_read", shape: "gitDiff" }, form: "rows", show: 3, words: ["repo"], thread });

describe("bindRow and boundToRow", () => {
  test("must-fail: $row.<field> is replaced by the row's field, as an argument and as a where value, beside $row", () => {
    expect(bindRow({ type: "record_read", refs_to: "$row", latest_by: "$row.repo", where: { tree: "$row.tree", role: "walk" } }, DIFF)).toEqual({
      type: "record_read", refs_to: DIFF.id, latest_by: DIFF.repo, where: { tree: TREE, role: "walk" },
    });
  });

  test("must-fail: a row without the field, or whose field is not a plain value, binds nothing", () => {
    expect(bindRow(byTree.pointer, { id: DIFF.id })).toBeNull();
    expect(bindRow(byTree.pointer, { id: DIFF.id, tree: { sha: TREE } })).toBeNull();
    expect(bindRow(byTree.pointer, { id: DIFF.id, tree: null })).toBeNull();
    expect(bindRow({ type: "record_read", refs_to: "$row" }, { tree: TREE })).toBeNull();
  });

  test("a value that only looks like a binding is left as written", () => {
    for (const v of ["$rows.tree", "$row.", "$row.tree.sha", "x$row.tree", "$row.1x"]) {
      expect(boundToRow({ type: "record_read", where: { tree: v } })).toBe(false);
      expect(bindRow({ type: "record_read", where: { tree: v } }, DIFF)).toEqual({ type: "record_read", where: { tree: v } });
    }
  });
});

describe("the write check", () => {
  beforeEach(() => resetViewsForTest());

  test("must-fail: a thread bound by a field is accepted", () => {
    expect(writeView({ region: "landing", entries: [changes(byTree)] }, null)).toMatchObject({ ok: true });
  });

  test("must-fail: a field binding outside a thread is refused, as $row is", () => {
    const got = writeView({ region: "landing", entries: [{ pointer: { type: "record_read", shape: "gitDiff", where: { tree: "$row.tree" } }, form: "rows" }] }, null);
    expect(got.ok).toBe(false);
    expect(got.ok ? "" : got.detail).toContain("only a thread's pointer is bound to a row");
  });

  test("must-fail: a bound thread still reads through records or the questions only", () => {
    const got = writeView({ region: "landing", entries: [changes({ ...byTree, pointer: { type: "gitDiff", where: { tree: "$row.tree" } } })] }, null);
    expect(got.ok).toBe(false);
    expect(got.ok ? "" : got.detail).toContain("a view reads through record_read or uiQuestion only");
  });
});

const reads: Record<string, unknown>[] = [];
let diffs: Record<string, unknown>[] = [];
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.includes("/api/discovery/resolve")) {
    const pointer = JSON.parse(String(init?.body)).pointer as Record<string, unknown>;
    if (pointer["type"] !== "record_read") return Response.json({});
    reads.push(pointer);
    if (pointer["shape"] === "gitDiff") return Response.json(diffs);
    const where = (pointer["where"] ?? {}) as Record<string, unknown>;
    if (pointer["shape"] === "land_verdict") return Response.json([VERDICT].filter((r) => Object.entries(where).every(([k, v]) => (r as Record<string, unknown>)[k] === v)));
    return Response.json([]);
  }
  if (url.includes("/api/questions")) return Response.json({ resolved: true, success: true, body: { questions: [] } });
  return Response.json({});
}) as typeof fetch;

const uiSrc = new URL("../ui/src/", import.meta.url).pathname;
const React = await import(Bun.resolveSync("react", uiSrc));
const { createRoot: rawCreateRoot } = await import(Bun.resolveSync("react-dom/client", uiSrc));
const createRoot = (...a: Parameters<typeof rawCreateRoot>) => trackRoot(rawCreateRoot(...a));
const { act } = React;
const { QueryClient, QueryClientProvider } = await import(Bun.resolveSync("@tanstack/react-query", uiSrc));
const { LiveControlsProvider } = await import("../ui/src/state/liveControls");
const { QuestionsProvider } = await import("../ui/src/state/questions");
const { Entries } = await import("../ui/src/components/Reports");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterAll(async () => {
  await teardownDom();
});
const settle = async () => {
  for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
};
async function mount(entries: unknown[]): Promise<HTMLElement> {
  const el = document.createElement("div");
  document.body.replaceChildren(el);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    createRoot(el).render(React.createElement(QueryClientProvider, { client: qc }, React.createElement(LiveControlsProvider, null, React.createElement(QuestionsProvider, null, React.createElement(Entries, { entries, enabled: true, intervalMs: 60_000, onOpenQuestion: () => {} })))));
  });
  await settle();
  return el;
}

describe("the page", () => {
  beforeEach(() => {
    reads.length = 0;
    diffs = [DIFF];
  });

  test("must-fail: under a change, a thread bound by its tree reads that tree and draws a verdict citing another diff of it", async () => {
    const el = await mount([changes(byTree)]);
    expect(reads.filter((p) => p["shape"] === "land_verdict")).toEqual([{ type: "record_read", shape: "land_verdict", where: { tree: TREE } }]);
    expect(el.querySelector(`.sf-thread[data-thread-of="${DIFF.id}"]`)!.textContent).toContain("Same tree, another diff.");
  });

  test("must-fail: a row without the field draws no thread and sends no read", async () => {
    const { tree: _t, ...untreed } = DIFF;
    diffs = [untreed];
    const el = await mount([changes(byTree)]);
    expect(el.querySelector(`.sf-row[data-row="${DIFF.id}"]`)).not.toBeNull();
    expect(el.querySelector(".sf-thread")).toBeNull();
    expect(reads.map((p) => p["shape"])).toEqual(["gitDiff"]);
  });
});
