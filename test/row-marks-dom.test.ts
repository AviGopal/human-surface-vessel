/**
 * A row's declared fields read as states (surface-acts-on-shapes-present R.6): a dot in the
 * state's colour, the declarer's word for the field and the state's own word. The binding is the
 * owner's `shape_description` row in its `marks`, else the view entry's `marks`, else none: the
 * surface names no field and reads no value itself.
 *
 * Shape: node1 11-16, a change whose typecheck had not passed sat beside Right and Wrong as a
 * folded field the person had to open; nothing drew its state where the verdict is made.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://surface.test/" });

import { afterAll, describe, expect, test } from "bun:test";
import { forgetViews, teardownDom, trackRoot } from "./setup.ts";
import { resetViewsForTest, writeView } from "../src/ui-views.ts";
import { declaredMarks, marksFor, marksProblem, rowMarks } from "../src/row-marks.ts";
import { declaredWords } from "../src/row-words.ts";

const DIFF = { input_refs: [], shape: "gitDiff", role: "walk", repo: "box-vessel", diff: "", typecheck: { ran: true, passed: false }, seq: 12, t: "2026-11-15T11:05:00.000Z", id: "b".repeat(64) };
const PASSES = { typecheck: [{ field: "typecheck.passed", states: { true: "reached", false: "not-reached" }, label: "typecheck" }] };
let diffs: unknown[] = [DIFF];
let declarations: unknown[] = [];
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.endsWith("/api/session")) return Response.json({ available: false, keySignIn: true, signedIn: false });
  if (url.includes("/api/discovery/resolve")) {
    const pointer = JSON.parse(String(init?.body)).pointer as Record<string, unknown>;
    if (pointer["type"] === "record_read" && pointer["shape"] === "shape_description") return Response.json(declarations);
    if (pointer["type"] === "record_read" && pointer["shape"] === "gitDiff") return Response.json(diffs);
  }
  return Response.json({});
}) as typeof fetch;

const uiSrc = new URL("../ui/src/", import.meta.url).pathname;
const React = await import(Bun.resolveSync("react", uiSrc));
const { createRoot: rawCreateRoot } = await import(Bun.resolveSync("react-dom/client", uiSrc));
const { act } = React;
const { QueryClient, QueryClientProvider } = await import(Bun.resolveSync("@tanstack/react-query", uiSrc));
const { Entries } = await import("../ui/src/components/Reports");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterAll(async () => {
  await teardownDom();
});
const settle = async () => {
  for (let i = 0; i < 4; i++) await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
};
async function mount(entry: Record<string, unknown>): Promise<Element> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    trackRoot(rawCreateRoot(el)).render(React.createElement(QueryClientProvider, { client: qc }, React.createElement(Entries, { entries: [entry] as never, enabled: true, intervalMs: 60_000, onOpenQuestion: () => {} })));
  });
  await settle();
  return el.querySelector(`.sf-row[data-row="${DIFF.id}"]`)!;
}
const ENTRY = { pointer: { type: "record_read", shape: "gitDiff" }, form: "rows", words: ["repo"], judge: "land" };
const marks = (row: Element) => [...row.querySelectorAll(".sf-state-mark")].map((m) => `${m.getAttribute("data-state")} ${[...m.querySelectorAll("span:not([aria-hidden])")].map((x) => x.textContent).join("|")}`);

describe("a row's declared fields read as states", () => {
  test("must-fail: a typecheck that did not pass reads not reached, above Right and Wrong", async () => {
    diffs = [DIFF];
    declarations = [{ shape: "shape_description", of: "gitDiff", marks: PASSES.typecheck, role: "owner", seq: 1 }];
    const row = await mount(ENTRY);
    expect(marks(row)).toEqual(["not-reached typecheck|no|not reached"]);
    const mark = row.querySelector(".sf-state-mark")!;
    // Shown as written: the value stays in view beside the state it reads as, never replaced by it.
    expect(mark.textContent).toContain("no");
    expect(mark.querySelector(".sf-state-mark-value")!.textContent).toBe("no");
    expect(mark.getAttribute("title")).toBe("typecheck.passed");
    const judge = row.querySelector(".sf-row-judge")!;
    expect(judge).not.toBeNull();
    expect(mark.compareDocumentPosition(judge) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test("must-fail: one that passed reads reached, the same weight", async () => {
    diffs = [{ ...DIFF, typecheck: { ran: true, passed: true } }];
    declarations = [{ shape: "shape_description", of: "gitDiff", marks: PASSES.typecheck, role: "owner", seq: 1 }];
    expect(marks(await mount(ENTRY))).toEqual(["reached typecheck|yes|reached"]);
  });

  test("control: no declaration, no mark; a value the binding does not name, no mark", async () => {
    diffs = [DIFF];
    declarations = [];
    expect(marks(await mount(ENTRY))).toEqual([]);
    diffs = [{ ...DIFF, typecheck: { ran: false } }];
    declarations = [{ shape: "shape_description", of: "gitDiff", marks: PASSES.typecheck, role: "owner", seq: 1 }];
    expect(marks(await mount(ENTRY))).toEqual([]);
  });

  test("must-fail: the entry's marks draw when the owner declares none, and the owner's come first", async () => {
    diffs = [DIFF];
    declarations = [];
    const entry = { ...ENTRY, marks: [{ field: "typecheck.ran", states: { true: "accepted" } }] };
    expect(marks(await mount(entry))).toEqual(["accepted typecheck.ran|yes|accepted"]);
    declarations = [{ shape: "shape_description", of: "gitDiff", marks: PASSES.typecheck, role: "owner", seq: 1 }];
    expect(marks(await mount(entry))).toEqual(["not-reached typecheck|no|not reached"]);
  });
});

describe("one rule for a view's marks and an owner's", () => {
  test("must-fail: a later declaration with no valid marks withdraws the earlier", () => {
    const one = { shape: "shape_description", of: "gitDiff", marks: PASSES.typecheck };
    expect(declaredMarks([one]).get("gitDiff")).toEqual(PASSES.typecheck);
    expect(declaredMarks([one, { shape: "shape_description", of: "gitDiff", words: ["repo"] }]).has("gitDiff")).toBe(false);
    expect(marksFor("gitDiff", declaredMarks([]), undefined)).toEqual([]);
  });

  test("must-fail: the latest row is the whole declaration, both ways: words alone withdraw marks, marks alone withdraw words", () => {
    const both = { shape: "shape_description", of: "gitDiff", words: ["repo"], marks: PASSES.typecheck };
    expect(declaredMarks([both]).has("gitDiff")).toBe(true);
    expect(declaredWords([both]).has("gitDiff")).toBe(true);
    expect(declaredMarks([both, { shape: "shape_description", of: "gitDiff", words: ["repo"] }]).has("gitDiff")).toBe(false);
    expect(declaredWords([both, { shape: "shape_description", of: "gitDiff", marks: PASSES.typecheck }]).has("gitDiff")).toBe(false);
  });

  test("must-fail: a path reads into nested values, three steps at most; a state outside the set is refused", () => {
    expect(rowMarks({ a: { b: { c: 3 } } }, [{ field: "a.b.c", states: { "3": "stalled" } }])).toEqual([{ field: "a.b.c", label: "a.b.c", value: 3, state: "stalled" }]);
    expect(marksProblem([{ field: "a.b.c.d", states: { x: "reached" } }])).not.toBeNull();
    expect(marksProblem([{ field: "a", states: { x: "green" } }])).not.toBeNull();
    expect(marksProblem([{ field: "a", states: {} }])).not.toBeNull();
    expect(marksProblem([{ field: "a", states: { x: "reached" }, colour: "red" }])).not.toBeNull();
    expect(marksProblem([{ field: "a", states: { x: "reached" }, label: "A" }])).toBeNull();
    // A row without the field, or with null there, says the binding's own words for that, with no value.
    const absent = [{ field: "a.b", states: { true: "reached" }, absent: { state: "waiting", label: "Never ran" } }] as const;
    expect(marksProblem(absent)).toBeNull();
    expect(rowMarks({}, absent)).toEqual([{ field: "a.b", label: "Never ran", value: null, state: "waiting" }]);
    expect(rowMarks({ a: null }, absent)).toEqual([{ field: "a.b", label: "Never ran", value: null, state: "waiting" }]);
    expect(rowMarks({ a: { b: null } }, absent)).toEqual([{ field: "a.b", label: "Never ran", value: null, state: "waiting" }]);
    expect(rowMarks({ a: { b: true } }, absent)).toEqual([{ field: "a.b", label: "a.b", value: true, state: "reached" }]);
    expect(rowMarks({ a: { b: false } }, absent)).toEqual([]);
    expect(marksProblem([{ field: "a", states: { x: "reached" }, absent: { state: "green", label: "x" } }])).not.toBeNull();
    expect(marksProblem([{ field: "a", states: { x: "reached" }, absent: { state: "waiting", label: " " } }])).not.toBeNull();
    expect(marksProblem([{ field: "a", states: { x: "reached" }, absent: { state: "waiting", label: "x", colour: "red" } }])).not.toBeNull();
  });

  test("must-fail: a view writes marks on rows only, and keeps them", () => {
    resetViewsForTest();
    const m = [{ field: "typecheck.passed", states: { false: "not-reached" } }];
    const ok = writeView({ region: "landing", entries: [{ pointer: ENTRY.pointer, form: "rows", marks: m }] }, null);
    expect(ok.ok).toBe(true);
    const refused = writeView({ region: "landing", entries: [{ pointer: { type: "record_read", shape: "answer" }, form: "fields", marks: m }] }, null);
    expect(refused.ok ? "" : refused.detail).toContain("marks needs form");
    const bad = writeView({ region: "landing", entries: [{ pointer: ENTRY.pointer, form: "rows", marks: [{ field: "x", states: { a: "green" } }] }] }, null);
    expect(bad.ok).toBe(false);
  });
});

// This file stores views; the next file in the same run counts revisions from none.
afterAll(forgetViews);
