/**
 * "page": markup drawn as a page in a frame that is granted nothing. Never a
 * default; a person asks for it in words ("show svg as a page", or "show this as
 * a page" in the box, which takes it only where the answer on screen has markup).
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://surface.test/" });

import { afterAll, describe, expect, test } from "bun:test";
import { teardownDom, trackRoot } from "./setup.ts";
import { readSurfaceIntent, readViewIntent } from "../src/surface-intent.ts";
import type { RenderPolicy } from "../src/store.ts";
import type { GoalWalkState } from "../ui/src/api/types";

const framePosts: string[] = [];
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  if (String(input).endsWith("/api/page-frame") && init?.method === "POST") {
    framePosts.push(String((JSON.parse(String(init.body)) as { source: string }).source));
    return new Response(JSON.stringify({ id: "a".repeat(64) }), { status: 200 });
  }
  // The person drew these shapes as pages before: the learned form the policy serves.
  if (String(input).endsWith("/api/render-policy")) {
    return new Response(JSON.stringify({ tokenOverrides: {}, formByShape: {}, learnedFormByShape: { http_fetch: "page", svg: "page" }, maxPreviewChars: null, ledgerDefaultExpanded: true, revision: 1, updatedAt: 0, note: null }), { status: 200 });
  }
  return new Response("{}", { status: 200 });
}) as typeof fetch;

const uiSrc = new URL("../ui/src/", import.meta.url).pathname;
const from = (spec: string): string => Bun.resolveSync(spec, uiSrc);
const React = await import(from("react"));
const { createRoot: rawCreateRoot } = await import(from("react-dom/client"));
const createRoot = (...a: Parameters<typeof rawCreateRoot>) => trackRoot(rawCreateRoot(...a));
const { act } = React;
const { QueryClient, QueryClientProvider } = await import(from("@tanstack/react-query"));
const { LiveControlsProvider } = await import("../ui/src/state/liveControls");
const { ContentRender } = await import("../ui/src/components/ContentRender");
const { Rendered } = await import("../ui/src/components/Rendered");
const { OnScreenProvider, useOnScreen } = await import("../ui/src/state/onScreen");
const { fromText } = await import("../ui/src/lib/content");
const { planContent } = await import("../ui/src/lib/ledger");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function mount(node: unknown): Promise<HTMLElement> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    createRoot(el).render(React.createElement(QueryClientProvider, { client: qc }, React.createElement(LiveControlsProvider, null, node as never)));
  });
  await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
  return el;
}

afterAll(async () => {
  await teardownDom();
});

const SVG = '<svg width="100" height="100"><circle cx="50" cy="50" r="40"><animate attributeName="r" values="10;40;10" dur="2s" repeatCount="indefinite"/></circle></svg>';

describe("the page frame", () => {
  test("must-fail: the frame grants nothing and loads the page from its own URL, not srcdoc", async () => {
    const el = await mount(React.createElement(ContentRender, { plan: { form: "page", text: SVG, decidedBy: "pin" } }));
    for (let i = 0; i < 3; i++) await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    const frame = el.querySelector("iframe");
    expect(frame).not.toBeNull();
    expect(frame?.getAttribute("sandbox")).toBe("");
    expect(frame?.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(frame?.hasAttribute("srcdoc")).toBe(false);
    expect(frame?.getAttribute("src")).toBe(`/api/page-frame/${"a".repeat(64)}`);
    expect(framePosts).toEqual([SVG]);
  });

  test("must-fail: the planner never picks page on its own", () => {
    expect(planContent("svg", SVG, false).form).toBe("text");
    expect(planContent("httpResponse", "<html><body><p>x</p></body></html>", false).form).toBe("text");
  });
});

describe("asking for it", () => {
  const POLICY = { tokenOverrides: {}, formByShape: {}, maxPreviewChars: null, ledgerDefaultExpanded: true, presentation: "onepage", revision: 0, updatedAt: 0, note: null } as unknown as RenderPolicy;
  test("\"show svg as a page\" pins page for that shape", () => {
    const r = readSurfaceIntent("show svg as a page", POLICY);
    expect(r.patch.formByShape?.["svg"]).toBe("page");
  });

  test("\"as a page\" is taken where the answer on screen has markup, and refused on prose", async () => {
    // What the lead answer reports to the box, then how the reader treats it.
    const seen: { markup?: boolean }[] = [];
    function Probe(): null {
      const e = useOnScreen();
      if (e) seen.push({ markup: e.markup });
      return null;
    }
    const answer = (text: string) =>
      React.createElement(OnScreenProvider, null,
        React.createElement(Rendered, { content: fromText("svg", text), density: "full", header: false, region: "run_answer", lead: true }),
        React.createElement(Probe, null));
    await mount(answer(SVG));
    expect(seen.at(-1)?.markup).toBe(true);
    await mount(answer("## Summary\n\nPlain words, no markup at all."));
    expect(seen.at(-1)?.markup).toBe(false);
    const on = (markup: boolean) => ({ shape: "svg", form: "text", markup, region: "run_answer" });
    expect(readViewIntent("show this as a page", on(true))).toMatchObject({ kind: "view", form: "page" });
    expect(readViewIntent("show this as a page", on(false))).toMatchObject({ kind: "refused" });
  });
});

describe("how much of a page is drawn", () => {
  const html = (n: number) => `<html><body><p>${"x".repeat(n)}</p></body></html>`;
  async function drawn(content: unknown): Promise<HTMLElement> {
    return mount(React.createElement(Rendered, { content, density: "full", header: false, region: "run_answer", lead: true }));
  }
  test("must-fail: a page cut by the run's preview says so, with the run's own sizes", async () => {
    const el = await drawn({ shape: "http_fetch", origin: "impulse", body: html(1950), state: "truncated", size: { shown: 2000, total: 48907 } });
    expect(el.querySelector(".sf-page-cut")?.textContent).toBe("Cut off: the first 2,000 of 48,907 characters");
  });
  test("must-fail: a whole page shows no mark", async () => {
    const page = html(40);
    const el = await drawn({ shape: "http_fetch", origin: "impulse", body: page, state: "full", size: { shown: page.length, total: page.length } });
    expect(el.querySelector(".sf-page-cut")).toBeNull();
  });
  test("must-fail: without the run's report, completeness is unknown, never whole", async () => {
    const el = await drawn(fromText("svg", SVG));
    expect(el.querySelector(".sf-page-cut")?.textContent).toBe("Completeness unknown");
  });
});

describe("a page drawn from the answer's basis record", () => {
  test("must-fail: a cut basis record says it is cut, and invents no total", async () => {
    const { basisContent } = await import("../ui/src/components/Answer");
    // The basis kept the record cut: it doesn't parse, and the run reports no total for it.
    const cut = `{"shape":"http_fetch","body":{"bodyText":"<html><body><p>${"y".repeat(300)}`;
    const content = basisContent(`# Fetch it\nreached\n## Basis\n\n${cut}`, "Fetch it", "d1", ["http_fetch"]);
    expect(content?.state).toBe("truncated");
    expect(content?.size).toBeUndefined();
    const el = await mount(React.createElement(Rendered, { content, density: "full", header: false, region: "run_answer", lead: true }));
    expect(el.querySelector(".sf-page-cut")?.textContent).toBe("Cut off");
  });
});
