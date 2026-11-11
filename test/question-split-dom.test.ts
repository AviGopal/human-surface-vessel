/**
 * The rail says what its groups are in plain words and draws how the questions split: one bar,
 * a segment per group as wide as the group's count, in the groups' order; each group head
 * carries its segment's swatch, so the heads are the legend. The bar totals exactly the counts
 * on the heads. A group differs by shape as well as fill, so no group is told apart by colour
 * alone, and no verdict colour is spent on a group that is not a verdict.
 *
 * Shape: one node 11-11. The rail read "NOTICES 73 / NO READER 191 / MALFORMED 17 / 248
 * lower-ranked not shown"; the USER: "some machine-like information is rendered for the human in
 * a non-comprehensible way … a little graph or visual … with shapes and colors is better."
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://surface.test/" });

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { teardownDom, trackRoot } from "./setup.ts";

let CLASSES: Record<string, number> = { ask: 0, notice: 73, settled: 0, unread: 191, malformed: 17 };
const notice = (i: number) => ({ id: `n-${i}`, revision: 1, title: "Run finished", body: "Nothing to decide.", kind: "notice", createdAt: 0, updatedAt: 0, responses: [], answered: false, declined: false, rank: i + 1 });
const unread = (i: number) => ({ ...notice(i), id: `u-${i}`, kind: "gap_landed_close_proposal", title: "Recommit a fix", body: "Gap g failed.", readerListed: false, rank: 10 + i });
const ask = (i: number) => ({ ...notice(i), id: `a-${i}`, kind: "gap_needs_human", title: "Which way?", body: "Pick one.", readerListed: true, rank: i });
let QUESTIONS: unknown[] = [];
const RANKING = { solicitations_total: 281, shown_count: 33, not_shown_count: 248, slice_source: "ranked" };

globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = String(input);
  if (url.includes("/api/questions")) return Response.json({ resolved: true, success: true, body: { questions: QUESTIONS, classes: CLASSES, ranking: RANKING } });
  return Response.json({ resolved: true, success: true, body: {} });
}) as typeof fetch;

const uiSrc = new URL("../ui/src/", import.meta.url).pathname;
const React = await import(Bun.resolveSync("react", uiSrc));
const { createRoot: rawCreateRoot } = await import(Bun.resolveSync("react-dom/client", uiSrc));
const createRoot = (...a: Parameters<typeof rawCreateRoot>) => trackRoot(rawCreateRoot(...a));
const { act } = React;
const { QueryClient, QueryClientProvider } = await import(Bun.resolveSync("@tanstack/react-query", uiSrc));
const { LiveControlsProvider } = await import("../ui/src/state/liveControls");
const { QuestionsProvider } = await import("../ui/src/state/questions");
const { QuestionsList } = await import("../ui/src/components/QuestionsList");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterAll(async () => {
  await teardownDom();
});

const settle = async () => {
  for (let i = 0; i < 4; i++) await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
};

async function draw(child: unknown): Promise<HTMLElement> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    createRoot(el).render(React.createElement(QueryClientProvider, { client: qc }, React.createElement(LiveControlsProvider, null, React.createElement(QuestionsProvider, null, child))));
  });
  await settle();
  return el;
}

const list = () => draw(React.createElement(QuestionsList, { selectedId: null, onSelect: () => {} }));
const heads = (el: HTMLElement) => [...el.querySelectorAll(".sf-qgroup-head")];
const parts = (el: HTMLElement) => [...el.querySelectorAll(".sf-qsplit > .sf-qsplit-part")] as HTMLElement[];
beforeEach(() => {
  CLASSES = { ask: 0, notice: 73, settled: 0, unread: 191, malformed: 17 };
  QUESTIONS = [notice(0), unread(0), ask(0)];
});

describe("the rail in plain words, its split drawn", () => {
  test("must-fail: the heads are plain words with their counts", async () => {
    const el = await list();
    expect(heads(el).map((h) => h.textContent)).toEqual(["Needs your decision1", "For your information73", "No reader listed for your answer191", "Empty or unfilled: nothing to answer17"]);
    expect(el.textContent).not.toMatch(/No reader\d|Malformed|Notices|lower-ranked/);
  });

  test("must-fail: one segment per head, in its order, its fill the head's swatch, totalling the heads' counts", async () => {
    const el = await list();
    const fills = heads(el).map((h) => h.querySelector(".sf-qswatch")!.getAttribute("data-fill"));
    expect(fills).toEqual(["ask", "notice", "unread", "malformed"]);
    expect(parts(el).map((p) => p.getAttribute("data-fill"))).toEqual(fills);
    const counts = heads(el).map((h) => Number(h.querySelector(".sf-qgroup-count")!.textContent));
    expect(parts(el).map((p) => Number(p.style.flexGrow))).toEqual(counts);
    expect(parts(el).reduce((n, p) => n + Number(p.style.flexGrow), 0)).toBe(counts.reduce((a, b) => a + b, 0));
    const bar = el.querySelector(".sf-qsplit")!;
    expect(bar.getAttribute("role")).toBe("img");
    expect(bar.getAttribute("aria-label")).toBe("Questions: 1 needs your decision, 73 for your information, 191 no reader listed for your answer, 17 empty or unfilled: nothing to answer.");
  });

  test("must-fail: a group of 1 beside 191 still has its segment", async () => {
    CLASSES = { ask: 0, notice: 0, settled: 0, unread: 191, malformed: 1 };
    QUESTIONS = [unread(0)];
    const el = await list();
    expect(parts(el).map((p) => [p.getAttribute("data-fill"), Number(p.style.flexGrow)])).toEqual([["unread", 191], ["malformed", 1]]);
  });

  test("must-fail: the foot says in words what was left out", async () => {
    const el = await list();
    expect(el.querySelector(".sf-rail-foot")!.textContent).toBe("248 more, less urgent, not listed");
  });

  test("control: the bar is no list row: it carries no exposure role", async () => {
    const el = await list();
    expect(el.querySelector(".sf-qsplit")!.hasAttribute("data-exposure-role")).toBe(false);
    expect(el.querySelectorAll('[data-exposure-role="list_row"]').length).toBe(3);
  });
});
