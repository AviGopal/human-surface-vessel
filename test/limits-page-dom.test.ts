/**
 * The page draws as much as the render policy's `limits` say: a `fields` entry shows the
 * policy's count of values before "and N more", and names the policy's count of a list's items.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://surface.test/" });

import { afterAll, describe, expect, test } from "bun:test";
import { teardownDom, trackRoot } from "./setup.ts";

const ANSWER = { found: ["p", "q", "r"], a: 1, b: 2, c: 3, d: 4 };
globalThis.fetch = (async (input: RequestInfo | URL) =>
  String(input).includes("/api/discovery/resolve") ? Response.json(ANSWER) : Response.json({})) as typeof fetch;

const uiSrc = new URL("../ui/src/", import.meta.url).pathname;
const React = await import(Bun.resolveSync("react", uiSrc));
const { createRoot: rawCreateRoot } = await import(Bun.resolveSync("react-dom/client", uiSrc));
const createRoot = (...a: Parameters<typeof rawCreateRoot>) => trackRoot(rawCreateRoot(...a));
const { act } = React;
const { QueryClient, QueryClientProvider } = await import(Bun.resolveSync("@tanstack/react-query", uiSrc));
const { Entries } = await import("../ui/src/components/Reports");
const { ContentRender } = await import("../ui/src/components/ContentRender");
const { LiveControlsProvider } = await import("../ui/src/state/liveControls");
const { QuestionsProvider } = await import("../ui/src/state/questions");
const { TopBar } = await import("../ui/src/components/TopBar");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterAll(async () => {
  await teardownDom();
});
const settle = async () => {
  for (let i = 0; i < 4; i++) await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
};

async function draw(limits: Record<string, number> | null, child: unknown): Promise<HTMLElement> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (limits) qc.setQueryData(["renderPolicy"], { tokenOverrides: {}, formByShape: {}, maxPreviewChars: null, ledgerDefaultExpanded: true, revision: 4, updatedAt: 0, note: null, limits });
  await act(async () => {
    createRoot(el).render(React.createElement(QueryClientProvider, { client: qc }, child));
  });
  await settle();
  return el;
}
const mount = (limits: Record<string, number> | null) =>
  draw(limits, React.createElement(Entries, { entries: [{ pointer: { type: "someReport" }, form: "fields", title: "A report" }] as never, enabled: true, intervalMs: 60_000, onOpenQuestion: () => {} }));
const plan = (form: string, text: string) => React.createElement(ContentRender, { plan: { form, text, decidedBy: "test" } });
const NESTED = JSON.stringify({ a: { b: { c: { d: 1 } } } });
const WIDE = JSON.stringify([{ k: "x", v: { long: "y".repeat(500) } }]);

describe("the page draws as much as the policy's limits say", () => {
  test("must-fail: fieldsShown and itemsNamed are the policy's", async () => {
    const el = await mount({ fieldsShown: 2, itemsNamed: 1 });
    expect(el.querySelectorAll(".sf-report-field").length).toBe(2);
    expect(el.textContent).toContain("and 3 more");
    expect(el.querySelector(".sf-report-items")?.textContent).toBe("p");
  });

  test("with no policy yet, the bootstrap defaults hold", async () => {
    const el = await mount(null);
    expect(el.querySelectorAll(".sf-report-field").length).toBe(5);
    expect(el.querySelector(".sf-report-items")?.textContent).toBe("p · q · r");
  });

  test("must-fail: a record nests only as deep as the policy's recordMaxDepth", async () => {
    expect((await draw({ recordMaxDepth: 1 }, plan("record", NESTED))).querySelectorAll(".sf-record--nested").length).toBe(0);
    expect((await draw(null, plan("record", NESTED))).querySelectorAll(".sf-record--nested").length).toBeGreaterThan(0);
  });

  test("must-fail: a table cell's tooltip is cut at the policy's cellTitleChars", async () => {
    const titles = async (limits: Record<string, number> | null) =>
      [...(await draw(limits, plan("rows", WIDE))).querySelectorAll("[title]")].map((t) => t.getAttribute("title")!.length);
    expect(Math.max(...(await titles({ cellTitleChars: 100 })))).toBe(100);
    expect(Math.max(...(await titles(null)))).toBeGreaterThan(500);
  });

  test("must-fail: the box grows to the policy's boxLines, then scrolls", async () => {
    // The suite's DOM does no layout: give the box a tall content height, and the line
    // height falls back to 20px.
    Object.defineProperty(window.HTMLTextAreaElement.prototype, "scrollHeight", { configurable: true, get: () => 1000 });
    const height = async (limits: Record<string, number> | null) => {
      const el = await draw(limits, React.createElement(LiveControlsProvider, null, React.createElement(QuestionsProvider, null,
        React.createElement(TopBar, { openIssues: null, onToggleIssues: () => {}, issuesOpen: false }))));
      const t = el.querySelector("textarea")!;
      await act(async () => {
        Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!.call(t, "a\nb\nc\nd");
        t.dispatchEvent(new Event("input", { bubbles: true }));
      });
      return t.style.height;
    };
    expect(await height({ boxLines: 3 })).toBe(`${20 * 3 + 16}px`);
    expect(await height(null)).toBe(`${20 * 8 + 16}px`);
  });
});
