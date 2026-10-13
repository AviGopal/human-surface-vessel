/**
 * "page": markup drawn as a page in a frame that is granted nothing. Never a
 * default; a person asks for it in words ("show svg as a page") or with Show as,
 * which offers it only where there is markup.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://surface.test/" });

import { afterAll, describe, expect, test } from "bun:test";
import { readSurfaceIntent } from "../src/surface-intent.ts";
import type { RenderPolicy } from "../src/store.ts";
import type { GoalWalkState } from "../ui/src/api/types";

globalThis.fetch = (async () => new Response("{}", { status: 200 })) as typeof fetch;

const uiSrc = new URL("../ui/src/", import.meta.url).pathname;
const from = (spec: string): string => Bun.resolveSync(spec, uiSrc);
const React = await import(from("react"));
const { createRoot } = await import(from("react-dom/client"));
const { act } = React;
const { QueryClient, QueryClientProvider } = await import(from("@tanstack/react-query"));
const { LiveControlsProvider } = await import("../ui/src/state/liveControls");
const { ContentRender, pageDocument } = await import("../ui/src/components/ContentRender");
const { Chain } = await import("../ui/src/components/Chain");
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
  test("must-fail: the frame grants nothing and its document refuses every fetch", async () => {
    const el = await mount(React.createElement(ContentRender, { plan: { form: "page", text: SVG, decidedBy: "pin" } }));
    const frame = el.querySelector("iframe");
    expect(frame).not.toBeNull();
    expect(frame?.getAttribute("sandbox")).toBe("");
    expect(frame?.getAttribute("referrerpolicy")).toBe("no-referrer");
    const doc = pageDocument(SVG);
    expect(doc).toContain("default-src 'none'");
    expect(doc.indexOf("Content-Security-Policy")).toBeLessThan(doc.indexOf("<svg"));
    expect(doc).toContain(SVG);
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

  test("Show as offers Page on markup and not on prose", async () => {
    const walk = (preview: string): GoalWalkState =>
      ({
        dispatchId: "d", status: "completed", reached: true, goalReachReason: null, poolShapes: [], pendingTargets: [], poolEvents: [], walkLog: [],
        currentStep: null, steps: [], executionPath: null, walkTier: null, attemptCount: null, grounded: null, learning: null, answerBody: null,
        operator: null, completionShapes: null, humanGraded: false, humanReachNotes: null, trigger: null, requeueOf: null,
        poolProvenance: [
          { id: "g", shape: "goal", producedBy: "seed", contentPreview: "q", chars: 1, consumedIds: [] },
          { id: "o", shape: "svg", producedBy: "satisfier:llm", contentPreview: preview, chars: preview.length, consumedIds: ["g"] },
        ],
      }) as unknown as GoalWalkState;
    const withMarkup = await mount(React.createElement(Chain, { walk: walk(SVG) }));
    const labels = [...withMarkup.querySelectorAll("[aria-label='Show as'] button")].map((b) => b.textContent);
    expect(labels).toContain("Page");
    const withProse = await mount(React.createElement(Chain, { walk: walk("## Summary\n\nPlain words, no markup at all.") }));
    expect([...withProse.querySelectorAll("[aria-label='Show as'] button")].map((b) => b.textContent)).not.toContain("Page");
  });
});
