/**
 * "page": markup drawn as a page in a frame that is granted nothing. Never a
 * default; a person asks for it in words ("show svg as a page", or "show this as
 * a page" in the box, which takes it only where the answer on screen has markup).
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://surface.test/" });

import { afterAll, describe, expect, test } from "bun:test";
import { readSurfaceIntent, readViewIntent } from "../src/surface-intent.ts";
import type { RenderPolicy } from "../src/store.ts";
import type { GoalWalkState } from "../ui/src/api/types";

const framePosts: string[] = [];
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  if (String(input).endsWith("/api/page-frame") && init?.method === "POST") {
    framePosts.push(String((JSON.parse(String(init.body)) as { source: string }).source));
    return new Response(JSON.stringify({ id: "a".repeat(64) }), { status: 200 });
  }
  return new Response("{}", { status: 200 });
}) as typeof fetch;

const uiSrc = new URL("../ui/src/", import.meta.url).pathname;
const from = (spec: string): string => Bun.resolveSync(spec, uiSrc);
const React = await import(from("react"));
const { createRoot } = await import(from("react-dom/client"));
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
  await GlobalRegistrator.unregister();
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
