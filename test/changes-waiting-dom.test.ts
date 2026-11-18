/**
 * What waits on the person's grade is the page's own, drawn first above whatever view is in force: a stored view
 * that names nothing of it still draws it, and no view can move or hide it. Records answers the waits (`person_wait`,
 * derived from a walk failure waiting for a person with no person row about its root since); under each, what was
 * asked, then the walk's newest change for it with what its checks said and Right or Wrong. With no change yet it says
 * "Not checked yet" and offers nothing to grade. Nothing waiting: its title and a 0.
 *
 * Shapes: on a live node, an ask's change waited ~19 h for a person's verdict at land (git_land answered waits_for
 * person, lifted onto the walk's failure row) while the landing in force was a stored view with no entry reading it,
 * and the default's "Waiting on you" read only questions, so the wait was drawn nowhere. The person_wait row is as
 * records' read answers it: its id prefixed, its root and the tree that waits plain, the failure it was derived from in
 * input_refs. On that node the ask's newest diff was of an older tree than the one waiting, which had none, and its
 * diff's check was null (no tests ran).
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://surface.test/" });

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { teardownDom, trackRoot } from "./setup.ts";
import { DEFAULT_VIEWS, PAGE_ENTRIES, currentView, resetViewsForTest, writeView } from "../src/ui-views.ts";

const hex = (c: string): string => c.repeat(64);
const at = (seq: number): string => `2026-11-16T09:${String(seq).padStart(2, "0")}:00.000Z`;
const ASK = { input_refs: [], shape: "world_changed", what: "Show each held check as a short headline.", seq: 1, t: at(1), writer: "key_person_1", role: "person", id: hex("a") };
const GAP_ROOT = { input_refs: [], shape: "gap", gap_id: "shell-run-escapes", claim: "A shell run can leave its directory.", status: "open", seq: 2, t: at(2), writer: "detector", role: "detector", id: hex("b") };
const PATCH = "diff --git a/ui/a.ts b/ui/a.ts\n--- a/ui/a.ts\n+++ b/ui/a.ts\n@@ -1 +1 @@\n-const A = 1;\n+const A = 2;\n";
const DIFF = { input_refs: [ASK.id], shape: "gitDiff", role: "walk", writer: "walk", cwd: "/w", repo: "page-vessel", base: "1".repeat(40), head: "2".repeat(40), tree: "3".repeat(40), diff: PATCH, truncated: false, typecheck: { ran: true, passed: true, exit_code: 0, out: "", truncated: false }, seq: 4, t: at(4), id: hex("d") };
const failure = (seq: number, id: string) => ({ input_refs: [hex("9")], shape: "failure", role: "walk", writer: "walk", waits_for: "person", status: 409, selection_ref: hex("8"), seq, t: at(seq), id });
const wait = (root: string, tree: string | null, f: { id: string; seq: number; t: string; selection_ref: string }) => ({ shape: "person_wait", id: `person_wait:${f.id}`, writer: "records", role: "records", root, tree, repo: tree === null ? null : DIFF.repo, waits_for: "person", seq: f.seq, t: f.t, selection_ref: f.selection_ref, input_refs: [f.id] });
const F_ASK = failure(5, hex("e"));
const F_GAP = failure(6, hex("f"));
const WAIT_ASK = wait(ASK.id, DIFF.tree, F_ASK);
const WAIT_GAP = wait(GAP_ROOT.id, "5".repeat(40), F_GAP);
// A newer diff of the ask, of another tree than the one waiting: never the one offered for this wait.
const OTHER = { ...DIFF, tree: "6".repeat(40), head: "7".repeat(40), repo: "other-tree-vessel", seq: 7, t: at(7), id: hex("6") };

let rows: Record<string, unknown>[] = [];
const sent: Record<string, unknown>[] = [];
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.endsWith("/api/session")) return Response.json({ keySignIn: true, signedIn: true, person: { userId: "key_person_1", name: null, email: null, expiresAt: Date.now() + 900_000 } });
  if (url.includes("/api/discovery/resolve")) {
    const p = JSON.parse(String(init?.body)).pointer as Record<string, unknown>;
    sent.push(p);
    if (p["type"] !== "record_read") return Response.json({ success: true, shape: String(p["type"]), body: { questions: [], total: 0 } });
    // records' read: shape, refs_to, where (equality); rows oldest first.
    const where = (p["where"] ?? {}) as Record<string, unknown>;
    return Response.json(rows.filter((o) =>
      (p["shape"] === undefined || o["shape"] === p["shape"]) &&
      (p["refs_to"] === undefined || (o["input_refs"] as string[]).includes(String(p["refs_to"]))) &&
      Object.entries(where).every(([k, v]) => o[k] !== undefined && String(o[k]) === String(v))));
  }
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
const { Landing } = await import("../ui/src/components/Landing");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterAll(async () => {
  await teardownDom();
});
beforeEach(() => {
  sent.length = 0;
});

// A stored view as the live node had it: it names nothing that reads a wait.
const STORED = { pointer: { type: "record_read", shape: "world_changed" }, form: "rows", title: "What do you want to show me?", words: ["what"] };

async function mount(entries: unknown[] = [STORED]): Promise<HTMLElement> {
  resetViewsForTest();
  const served = currentView("landing");
  const view = { ...served, revision: 15, id: "landing@15", entries, isDefault: false, drawsDefault: false };
  const el = document.createElement("div");
  document.body.replaceChildren(el);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    createRoot(el).render(React.createElement(QueryClientProvider, { client: qc },
      React.createElement(LiveControlsProvider, null, React.createElement(QuestionsProvider, null, React.createElement(Landing, { view, onOpenQuestion: () => {} } as never)))));
  });
  for (let i = 0; i < 10; i++) await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  return el;
}
const block = (el: HTMLElement): Element | null => el.querySelector("[data-page-own]");
const rowIn = (scope: Element, id: string): Element | null => scope.querySelector(`.sf-row[data-row="${id}"]`);
// A row's own words line, not one of a reply drawn under it.
const ownWords = (row: Element): Element | undefined => [...row.children].find((c) => c.classList.contains("sf-row-words"));
const judges = (scope: Element): string[] => [...scope.querySelectorAll(".sf-judge-word")].map((b) => b.getAttribute("aria-label") ?? b.textContent ?? "");

describe("changes waiting on the person's grade are the page's own, first on the screen", () => {
  test("must-fail: served with every view, the stored one included, and held to a view entry's rules", () => {
    resetViewsForTest();
    expect(currentView("landing").above).toEqual(PAGE_ENTRIES);
    const w = writeView({ region: "landing", entries: [STORED] }, "walk");
    expect(w.ok).toBe(true);
    expect(currentView("landing").above).toEqual(PAGE_ENTRIES);
    // Never a view's own: a view can neither move nor hide it, and the default does not draw it twice.
    expect(DEFAULT_VIEWS.landing.entries.some((e) => (e.pointer as Record<string, unknown>)["shape"] === "person_wait")).toBe(false);
    resetViewsForTest();
    expect(writeView({ region: "landing", entries: [...PAGE_ENTRIES] }, "walk").ok).toBe(true);
    resetViewsForTest();
  });

  test("must-fail: a stored view that names no wait still draws the wait first, with what was asked and the change to grade", async () => {
    rows = [ASK, DIFF, F_ASK, WAIT_ASK, { ...ASK, id: hex("c"), what: "Another ask.", seq: 3, t: at(3) }];
    const el = await mount();
    const own = block(el);
    expect(own).not.toBeNull();
    // First: above every entry of the view in force.
    const reports = [...el.querySelectorAll("[data-report]")];
    expect(own!.contains(reports[0]!)).toBe(true);
    expect(sent).toContainEqual({ type: "record_read", shape: "person_wait" });
    const w = rowIn(own!, WAIT_ASK.id)!;
    expect(w).not.toBeNull();
    expect(rowIn(w, ASK.id)!.textContent).toContain(ASK.what);
    const change = rowIn(w, DIFF.id)!;
    expect(change).not.toBeNull();
    expect(change.textContent).toContain("page-vessel");
    // No test ran on it (check absent): said in words beside Right and Wrong, never no mark at all.
    const marks = [...change.querySelectorAll(".sf-state-mark")].map((m) => [m.getAttribute("data-field"), m.getAttribute("data-state"), m.querySelector(".sf-state-mark-label")!.textContent]);
    // It typechecks: the typecheck as written is drawn above Right and Wrong, and its mark adds nothing; no test ran.
    expect(change.querySelector("[data-typecheck]")!.textContent).toContain("typecheck passed yes");
    expect(marks).toEqual([["check.passed", "waiting", "No tests were run"]]);
    expect(judges(change)).toEqual(["Right", "Wrong"]);
  });

  test("must-fail: the change offered is the diff of the tree that waits, not the ask's newest diff", async () => {
    rows = [ASK, DIFF, OTHER, F_ASK, WAIT_ASK];
    const el = await mount();
    const w = rowIn(block(el)!, WAIT_ASK.id)!;
    expect(rowIn(w, DIFF.id)).not.toBeNull();
    expect(rowIn(w, OTHER.id)).toBeNull();
    expect(w.textContent).not.toContain("other-tree-vessel");
  });

  test("must-fail: of diffs of the tree that waits, only the walk's is offered, never one another writer made of it", async () => {
    const modelled = { ...DIFF, role: "described", writer: "described-shape-vessel", repo: "modelled-vessel", seq: 8, t: at(8), id: hex("7") };
    rows = [ASK, DIFF, modelled, F_ASK, WAIT_ASK];
    const w = rowIn(block(await mount())!, WAIT_ASK.id)!;
    expect(rowIn(w, DIFF.id)).not.toBeNull();
    expect(rowIn(w, modelled.id)).toBeNull();
    expect(w.textContent).not.toContain("modelled-vessel");
  });

  test("must-fail: of two walk diffs of the tree that waits, the newer is offered with its own checks", async () => {
    const older = { ...DIFF, check: { passed: false, gap_id: "shell-run-escapes" } };
    const newer = { ...DIFF, check: { passed: true, gap_id: "shell-run-escapes" }, seq: 9, t: at(9), id: hex("c") };
    rows = [ASK, older, newer, F_ASK, WAIT_ASK];
    const w = rowIn(block(await mount())!, WAIT_ASK.id)!;
    expect(rowIn(w, newer.id)).not.toBeNull();
    expect(rowIn(w, older.id)).toBeNull();
    const marks = [...rowIn(w, newer.id)!.querySelectorAll(".sf-state-mark")].map((m) => [m.getAttribute("data-field"), m.getAttribute("data-state")]);
    expect(marks).toEqual([["check.passed", "reached"]]);
  });

  test("must-fail: a diff of the same tree made for another ask is not offered: a grade of it is not about this ask, so it would not answer this wait", async () => {
    const ASK2 = { ...ASK, what: "Another ask.", seq: 3, t: at(3), id: hex("2") };
    const elsewhere = { ...DIFF, input_refs: [ASK2.id], repo: "elsewhere-vessel", seq: 8, t: at(8), id: hex("3") };
    rows = [ASK, ASK2, elsewhere, F_ASK, WAIT_ASK];
    const w = rowIn(block(await mount())!, WAIT_ASK.id)!;
    expect(rowIn(w, elsewhere.id)).toBeNull();
    expect(w.textContent).toContain("Not checked yet: no change to grade.");
  });

  test("must-fail: when the tree that waits has no diff, an older tree's diff is not offered in its place", async () => {
    rows = [ASK, OTHER, F_ASK, WAIT_ASK];
    const el = await mount();
    const w = rowIn(block(el)!, WAIT_ASK.id)!;
    expect(rowIn(w, OTHER.id)).toBeNull();
    expect(w.textContent).toContain("Not checked yet: no change to grade.");
    expect(judges(w)).toEqual([]);
  });

  test("must-fail: a wait that states no tree (written before the walk named it) says not checked, reads nothing for it, offers nothing", async () => {
    const before = wait(ASK.id, null, F_ASK);
    rows = [ASK, DIFF, OTHER, F_ASK, before];
    const el = await mount();
    const w = rowIn(block(el)!, before.id)!;
    expect(w.textContent).toContain("Not checked yet: no change to grade.");
    expect(rowIn(w, DIFF.id)).toBeNull();
    expect(rowIn(w, OTHER.id)).toBeNull();
    expect(judges(w)).toEqual([]);
    expect(sent.some((p) => p["shape"] === "gitDiff")).toBe(false);
  });

  test("must-fail: a diff never type-checked, with check null, says both in words", async () => {
    const { typecheck: _t, ...bare } = DIFF;
    rows = [ASK, { ...bare, check: null }, F_ASK, WAIT_ASK];
    const el = await mount();
    const change = rowIn(rowIn(block(el)!, WAIT_ASK.id)!, DIFF.id)!;
    const said = [...change.querySelectorAll(".sf-state-mark")].map((m) => [m.getAttribute("data-field"), m.getAttribute("data-state"), m.querySelector(".sf-state-mark-label")!.textContent]);
    expect(said).toEqual([["typecheck.passed", "waiting", "Not type-checked"], ["check.passed", "waiting", "No tests were run"]]);
    expect(change.querySelectorAll(".sf-state-mark-value").length).toBe(0);
    expect(judges(change)).toEqual(["Right", "Wrong"]);
  });

  test("must-fail: a change whose checks failed says so beside Right and Wrong", async () => {
    const failed = { ...DIFF, typecheck: { ran: true, passed: false, exit_code: 2, out: "a.ts(1,7): error", truncated: false }, check: { passed: false, gap_id: "shell-run-escapes" } };
    rows = [ASK, failed, F_ASK, WAIT_ASK];
    const el = await mount();
    const change = rowIn(rowIn(block(el)!, WAIT_ASK.id)!, DIFF.id)!;
    const marks = [...change.querySelectorAll(".sf-state-mark")].map((m) => [m.getAttribute("data-field"), m.getAttribute("data-state")]);
    expect(marks).toEqual([["typecheck.passed", "not-reached"], ["check.passed", "not-reached"]]);
  });

  test("must-fail: a wait with no change yet says it is not checked and offers nothing to grade", async () => {
    rows = [GAP_ROOT, F_GAP, WAIT_GAP];
    const el = await mount();
    const w = rowIn(block(el)!, WAIT_GAP.id)!;
    expect(w).not.toBeNull();
    expect(rowIn(w, GAP_ROOT.id)!.textContent).toContain(GAP_ROOT.claim);
    expect(w.textContent).toContain("Not checked yet: no change to grade.");
    expect(judges(w)).toEqual([]);
  });

  test("must-fail: of two waits, the newer is drawn first", async () => {
    rows = [ASK, GAP_ROOT, DIFF, F_ASK, F_GAP, WAIT_ASK, WAIT_GAP];
    const b = block(await mount())!;
    const waits = [...b.querySelectorAll(".sf-row[data-row^='person_wait:']")].map((r) => r.getAttribute("data-row"));
    expect(waits).toEqual([WAIT_GAP.id, WAIT_ASK.id]);
  });

  test("must-fail: a stored view's mark keeps its words for absence: written, served, and drawn", async () => {
    resetViewsForTest();
    const marked = { ...STORED, words: ["what"], marks: [{ field: "seen", states: { true: "reached" }, absent: { state: "waiting", label: " Not seen yet " } }] };
    expect(writeView({ region: "landing", entries: [marked] }, "walk").ok).toBe(true);
    const served = currentView("landing").entries;
    expect((served[0] as { marks?: unknown }).marks).toEqual([{ field: "seen", states: { true: "reached" }, absent: { state: "waiting", label: "Not seen yet" } }]);
    rows = [ASK];
    const el = await mount([...served]);
    const ask = [...el.querySelectorAll(`.sf-row[data-row="${ASK.id}"]`)].find((r) => !block(el)!.contains(r))!;
    const said = [...ask.querySelectorAll(".sf-state-mark")].map((m) => [m.getAttribute("data-state"), m.querySelector(".sf-state-mark-label")!.textContent]);
    expect(said).toEqual([["waiting", "Not seen yet"]]);
    expect(ask.querySelectorAll(".sf-state-mark-value").length).toBe(0);
  });

  test("must-fail: a wait row without the tree field draws no change line at all; only a stated null says not checked", async () => {
    const { tree: _tree, ...unstated } = wait(ASK.id, null, F_ASK);
    rows = [ASK, DIFF, F_ASK, unstated];
    const w = rowIn(block(await mount())!, unstated.id)!;
    expect(w).not.toBeNull();
    expect(w.textContent).not.toContain("Not checked yet");
    expect(rowIn(w, DIFF.id)).toBeNull();
  });

  test("must-fail: a wait draws no name of its shape: what was asked, under it, says what waits", async () => {
    rows = [ASK, DIFF, F_ASK, WAIT_ASK];
    const w = rowIn(block(await mount())!, WAIT_ASK.id)!;
    expect(w).not.toBeNull();
    expect(ownWords(w)).toBeUndefined();
    expect(w.textContent).not.toContain("person wait");
    expect(rowIn(w, ASK.id)!.textContent).toContain(ASK.what);
  });

  test("control: a row with no words and no thread under it still names its shape", async () => {
    rows = [ASK];
    const el = await mount([{ pointer: { type: "record_read", shape: "world_changed" }, form: "rows", title: "Asked" }]);
    expect(ownWords(rowIn(el, ASK.id)!)!.textContent).toBe("world changed");
  });

  test("must-fail: a row whose thread binds nothing on it still names its shape, so it is never drawn blank", async () => {
    rows = [ASK];
    const el = await mount([{ pointer: { type: "record_read", shape: "world_changed" }, form: "rows", thread: { pointer: { type: "record_read", where: { id: "$row.root" } }, form: "rows" } }]);
    expect(ownWords(rowIn(el, ASK.id)!)!.textContent).toBe("world changed");
  });

  test("a row stating none where its thread is bound, with the thread's words for none, draws those words and no name of its shape", async () => {
    rows = [WAIT_ASK, { ...WAIT_GAP, tree: null }];
    const el = await mount([{ pointer: { type: "record_read", shape: "person_wait" }, form: "rows", thread: { pointer: { type: "record_read", shape: "gitDiff", where: { tree: "$row.tree" } }, form: "rows", empty: "Nothing to grade." } }]);
    const stated = rowIn([...el.querySelectorAll("[data-report]")].find((r) => !block(el)!.contains(r))!, WAIT_GAP.id)!;
    expect(ownWords(stated)).toBeUndefined();
    expect(stated.textContent).toContain("Nothing to grade.");
  });

  test("a row stating none where its thread is bound, with no words for none, still names its shape", async () => {
    rows = [{ ...WAIT_GAP, tree: null }];
    const el = await mount([{ pointer: { type: "record_read", shape: "person_wait" }, form: "rows", thread: { pointer: { type: "record_read", shape: "gitDiff", where: { tree: "$row.tree" } }, form: "rows" } }]);
    const stated = rowIn([...el.querySelectorAll("[data-report]")].find((r) => !block(el)!.contains(r))!, WAIT_GAP.id)!;
    expect(ownWords(stated)!.textContent).toBe("person wait");
  });

  test("a row with no id, no words and a thread that would read names its shape: a thread is drawn only under a row with an id", async () => {
    const { id: _id, ...noId } = ASK;
    rows = [noId];
    const el = await mount([{ pointer: { type: "record_read", shape: "world_changed" }, form: "rows", thread: { pointer: { type: "record_read", shape: "answer" }, form: "rows" } }]);
    const row = [...el.querySelectorAll(".sf-row")].find((r) => !block(el)!.contains(r))!;
    expect(ownWords(row)!.textContent).toBe("world changed");
  });

  test("control: nothing waiting draws its title and a 0, and no row", async () => {
    rows = [ASK, DIFF];
    const el = await mount();
    const own = block(el)!;
    expect(own.querySelector(".sf-row")).toBeNull();
    expect(own.textContent).toContain("Changes waiting on you");
    expect(own.textContent).toContain("0");
  });
});
