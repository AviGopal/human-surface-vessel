/**
 * A change the walk made for an ask is drawn under that ask, and a person can judge it: `judge: "land"`
 * writes a land_verdict citing the change, carrying the row's own `repo` and `tree`, the keys a landing
 * reads verdicts by. The page copies one landing condition only, by the USER's ruling that a mark is
 * offered only where it counts: a Right counts only on the whole change, so on one cut short Right is
 * not offered and says why. Every other change is offered both, and nothing is refused. The change is drawn as a diff, folded
 * under its size, and one cut short says so. The system's own grade stays closed until the person has
 * judged, so it cannot anchor them.
 *
 * Shape: qa 11-15, the USER meant to mark a landing Wrong and the page offered no landing to mark; the
 * walk's gitDiff cites its ask directly (records, read by database), so the change is a thread of the ask.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://surface.test/" });

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { teardownDom, trackRoot } from "./setup.ts";
import { DEFAULT_VIEWS, resetViewsForTest, writeView } from "../src/ui-views.ts";

const ASK = { input_refs: [], shape: "world_changed", what: "Make the message box hold ten lines.", seq: 10, t: "2026-11-15T11:00:00.000Z", role: "person", id: "a".repeat(64) };
const PATCH = "diff --git a/ui/box.ts b/ui/box.ts\n--- a/ui/box.ts\n+++ b/ui/box.ts\n@@ -1,2 +1,2 @@\n-const LINES = 8;\n+const LINES = 10;\n const keep = true;\n";
const DIFF = { input_refs: [ASK.id], shape: "gitDiff", role: "walk", repo: "box-vessel", base: "1".repeat(40), head: "2".repeat(40), tree: "3".repeat(40), diff: PATCH, truncated: false, typecheck: { passed: true }, seq: 12, t: "2026-11-15T11:05:00.000Z", id: "b".repeat(64) };
const GRADE = { input_refs: [ASK.id, DIFF.id], shape: "land_verdict", role: "described", repo: DIFF.repo, tree: DIFF.tree, r: 1, why: "It sets ten.", seq: 13, t: "2026-11-15T11:06:00.000Z", id: "c".repeat(64) };

let diffs: Record<string, unknown>[] = [];
let signedIn = true;
const written: string[] = [];
const reads: Record<string, unknown>[] = [];
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  const person = { userId: "key_person_1", name: null, email: null, expiresAt: Date.now() + 900_000 };
  if (url.endsWith("/api/session")) return Response.json({ keySignIn: true, signedIn, person: signedIn ? person : null });
  if (url.includes("/api/discovery/resolve")) {
    const raw = String(init?.body);
    const pointer = JSON.parse(raw).pointer as Record<string, unknown>;
    if (pointer["type"] === "record_write") {
      written.push(raw);
      return Response.json({ resolved: true, success: true, body: { ...(pointer["row"] as object), seq: 20 + written.length, id: "f".repeat(64) } });
    }
    if (pointer["type"] !== "record_read") return Response.json({});
    reads.push(pointer);
    if (pointer["shape"] === "world_changed") return Response.json([ASK]);
    if (pointer["shape"] === "gitDiff" && pointer["refs_to"] === ASK.id) return Response.json(diffs);
    if (pointer["shape"] === "land_verdict" && pointer["refs_to"] === DIFF.id) return Response.json([GRADE]);
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
beforeEach(() => {
  diffs = [DIFF];
  signedIn = true;
  written.length = 0;
  reads.length = 0;
  document.body.replaceChildren();
});
const settle = async () => {
  for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
};

/** The asks as the default landing draws them, with the change under each. */
const asks = DEFAULT_VIEWS.landing.entries.find((e) => e.title === "What people asked")!;

async function mount(entries: unknown[] = [asks]): Promise<HTMLElement> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    createRoot(el).render(React.createElement(QueryClientProvider, { client: qc }, React.createElement(LiveControlsProvider, null, React.createElement(QuestionsProvider, null, React.createElement(Entries, { entries, enabled: true, intervalMs: 60_000, onOpenQuestion: () => {} })))));
  });
  await settle();
  return el;
}
const change = (el: HTMLElement) => el.querySelector(`.sf-row[data-row="${DIFF.id}"]`) as HTMLElement | null;
async function judge(el: HTMLElement, word: "Right" | "Wrong") {
  const b = [...change(el)!.querySelectorAll(".sf-judge-word")].find((x) => (x.getAttribute("aria-label") ?? x.textContent) === word) as HTMLButtonElement;
  await act(async () => { b.click(); });
  await settle();
}
const rowOf = (raw: string) => (JSON.parse(raw).pointer as { row: Record<string, unknown> }).row;

describe("a change judged under its ask", () => {
  test("must-fail: Wrong writes a land_verdict citing the change, with its repo and tree and nothing else", async () => {
    const el = await mount();
    expect(change(el)).not.toBeNull();
    await judge(el, "Wrong");
    expect(written).toHaveLength(1);
    expect(rowOf(written[0]!)).toEqual({ shape: "land_verdict", r: 0, input_refs: [DIFF.id], repo: DIFF.repo, tree: DIFF.tree });
  });

  test("must-fail: Right writes r 1 the same way", async () => {
    const el = await mount();
    await judge(el, "Right");
    expect(rowOf(written[0]!)).toEqual({ shape: "land_verdict", r: 1, input_refs: [DIFF.id], repo: DIFF.repo, tree: DIFF.tree });
  });

  test("must-fail: on a change cut short, Right is not offered and says why; Wrong is, and writes as before", async () => {
    diffs = [{ ...DIFF, truncated: true }];
    const el = await mount();
    const [right, wrong] = [...change(el)!.querySelectorAll(".sf-judge-word")] as HTMLButtonElement[];
    expect(right!.getAttribute("aria-label")).toBe("Right");
    expect(right!.disabled).toBe(true);
    expect(change(el)!.querySelector("[data-right-needs-whole]")!.textContent).toBe("Right needs the whole change");
    expect(right!.getAttribute("aria-describedby")).toBe(change(el)!.querySelector("[data-right-needs-whole]")!.id);
    expect(wrong!.disabled).toBe(false);
    expect(change(el)!.querySelector("[data-diff] summary")!.textContent).toContain("cut short: not the whole change");
    await judge(el, "Right");
    expect(written).toEqual([]);
    await judge(el, "Wrong");
    expect(rowOf(written[0]!)).toEqual({ shape: "land_verdict", r: 0, input_refs: [DIFF.id], repo: DIFF.repo, tree: DIFF.tree });
  });

  test("the page copies no other landing rule: a change not the walk's is offered both", async () => {
    diffs = [{ ...DIFF, role: "operator" }];
    const el = await mount();
    const words = [...change(el)!.querySelectorAll(".sf-judge-word")] as HTMLButtonElement[];
    expect(words.map((b) => b.disabled)).toEqual([false, false]);
    expect(change(el)!.querySelector("[data-right-needs-whole]")).toBeNull();
  });

  test("must-fail: the change is drawn as a diff, folded under its size", async () => {
    const el = await mount();
    const fold = change(el)!.querySelector("details[data-diff]") as HTMLDetailsElement;
    expect(fold).not.toBeNull();
    expect(fold.open).toBe(false);
    expect(fold.querySelector("summary")!.textContent).toBe("the change · +1 −1 lines");
    expect(fold.querySelector('.sf-diff-line[data-kind="added"]')!.textContent).toBe("+const LINES = 10;");
    expect(fold.querySelector('.sf-diff-line[data-kind="removed"]')!.textContent).toBe("-const LINES = 8;");
    // The repo is the change's headline, drawn as words.
    expect(change(el)!.querySelector(".sf-row-prose")!.textContent).toContain(DIFF.repo);
  });

  test("must-fail: the system's grade is neither read nor drawn before the person judges, and is closed after", async () => {
    const el = await mount();
    expect(change(el)!.querySelector("[data-system-grade]")).toBeNull();
    expect(reads.some((p) => p["shape"] === "land_verdict")).toBe(false);
    await judge(el, "Wrong");
    const grade = change(el)!.querySelector("details[data-system-grade]") as HTMLDetailsElement;
    expect(grade).not.toBeNull();
    expect(grade.open).toBe(false);
    expect(reads.find((p) => p["shape"] === "land_verdict")).toEqual({ type: "record_read", refs_to: DIFF.id, shape: "land_verdict", where: { role: "described" } });
    expect(grade.textContent).toContain("the system graded this: right");
  });

  test("must-fail: an ask the walk made no change for draws no line about changes", async () => {
    diffs = [];
    // A thread with nothing citing its row and no words for that says nothing, in any view.
    const el = await mount([{ pointer: { type: "record_read", shape: "world_changed" }, form: "rows", words: ["what"], thread: { pointer: { type: "record_read", refs_to: "$row", shape: "gitDiff" }, form: "rows" } }]);
    expect(el.querySelector(`.sf-row[data-row="${ASK.id}"]`)).not.toBeNull();
    expect(el.textContent).not.toContain("answered with no rows");
    expect(el.querySelector("[data-diff]")).toBeNull();
  });

  test("signed out, nothing is stored", async () => {
    signedIn = false;
    const el = await mount();
    const words = [...change(el)!.querySelectorAll(".sf-judge-word")] as HTMLButtonElement[];
    expect(words.every((b) => b.disabled)).toBe(true);
    expect(written).toEqual([]);
  });
});

describe("the change's typecheck, shown as written above Right and Wrong (agf_yb0fg6wwyq6y)", () => {
  const tc = (el: HTMLElement) => change(el)!.querySelector("[data-typecheck]") as HTMLElement | null;
  const lines = (el: HTMLElement) => [...tc(el)!.children].map((c) => (c.tagName === "DETAILS" ? c.querySelector("summary")!.textContent : c.textContent));
  const OUT = "[ui]\nui/src/components/Reports.tsx(812,9): error TS2304: Cannot find name 'parseHeadline'.";

  test("must-fail: each field in the row's order, the output folded under its name and verbatim, above the verdict; Right stays offered", async () => {
    diffs = [{ ...DIFF, typecheck: { ran: true, passed: false, exit_code: 2, out: OUT, truncated: true } }];
    const el = await mount();
    expect(lines(el)).toEqual(["typecheck ran yes", "typecheck passed no", "typecheck exit code 2", "typecheck out", "typecheck truncated yes"]);
    const out = tc(el)!.querySelector("details[data-field=out]") as HTMLDetailsElement;
    expect(out.open).toBe(false);
    expect(out.querySelector("pre")!.textContent).toBe(OUT);
    const right = [...change(el)!.querySelectorAll(".sf-judge-word")].find((b) => (b.getAttribute("aria-label") ?? b.textContent) === "Right") as HTMLButtonElement;
    expect(tc(el)!.compareDocumentPosition(right) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Shown, not a gate: the person's mark decides.
    expect(right.disabled).toBe(false);
    await judge(el, "Right");
    expect(rowOf(written[0]!)).toEqual({ shape: "land_verdict", r: 1, input_refs: [DIFF.id], repo: DIFF.repo, tree: DIFF.tree });
  });

  test("must-fail: nothing compiled is never drawn as errors added: the step's own words, and no sentence of the page's", async () => {
    // A check that compiled nothing (a project whose modules are not installed) as the step writes it.
    const NOT_CHECKED = "[ui] not checked: ui's modules are not installed on this node";
    diffs = [{ ...DIFF, typecheck: { ran: true, passed: false, exit_code: 0, out: NOT_CHECKED } }];
    const el = await mount();
    expect(tc(el)!.textContent).not.toContain("adds errors");
    expect(tc(el)!.textContent).not.toContain("compile");
    expect(lines(el)).toEqual(["typecheck ran yes", "typecheck passed no", "typecheck exit code 0", `typecheck out ${NOT_CHECKED}`]);
  });

  test("not run: its reason as the step wrote it", async () => {
    const why = "ui's modules are not installed on this node: its project cannot be compiled here";
    diffs = [{ ...DIFF, typecheck: { ran: false, passed: false, why } }];
    const el = await mount();
    expect(lines(el)).toEqual(["typecheck ran no", "typecheck passed no", `typecheck why ${why}`]);
    expect(tc(el)!.querySelector("details")).toBeNull();
  });

  test("control: a row with no typecheck, or one that is not an object, draws no line", async () => {
    diffs = [{ ...DIFF, typecheck: undefined }];
    expect(tc(await mount())).toBeNull();
    diffs = [{ ...DIFF, typecheck: "ok" }];
    expect(tc(await mount())).toBeNull();
    diffs = [{ ...DIFF, typecheck: {} }];
    expect(tc(await mount())).toBeNull();
  });
});

describe("the view contract", () => {
  test("must-fail: judge is outcome or land; graded needs a judge; land is taken on rows and in a thread", () => {
    const pointer = { type: "record_read", shape: "gitDiff" };
    const graded = { pointer: { type: "record_read", refs_to: "$row", shape: "land_verdict", where: { role: "described" } } };
    const refused = writeView({ region: "landing", entries: [{ pointer, form: "rows", judge: "merge" }] }, null);
    expect(refused.ok ? "" : refused.detail).toContain('judge: "outcome" or "land"');
    const bare = writeView({ region: "landing", entries: [{ pointer, form: "rows", graded }] }, null);
    expect(bare.ok ? "" : bare.detail).toContain("graded needs a judge");
    const onRows = writeView({ region: "landing", entries: [{ pointer, form: "rows", judge: "land", graded }] }, null);
    resetViewsForTest();
    expect(onRows.ok).toBe(true);
    const inThread = writeView({ region: "landing", entries: [{ pointer: { type: "record_read", shape: "world_changed" }, form: "rows", thread: { pointer: { ...pointer, refs_to: "$row" }, form: "rows", judge: "land", graded } }] }, null);
    resetViewsForTest();
    expect(inThread.ok).toBe(true);
  });

  test("the default asks draw their change, judged as a landing, its grades by the system's role", () => {
    const threads = asks.thread as readonly { pointer: Record<string, unknown>; judge?: string; graded?: { pointer: Record<string, unknown> } }[];
    const land = threads.find((t) => t.pointer["shape"] === "gitDiff");
    expect(land?.judge).toBe("land");
    expect(land?.graded?.pointer).toEqual({ type: "record_read", refs_to: "$row", shape: "land_verdict", where: { role: "described" } });
  });
});
