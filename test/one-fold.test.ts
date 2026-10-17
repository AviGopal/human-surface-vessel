/**
 * A finished run reads as its outcome with one fold, "How it went", holding the
 * attempts, the outputs and the provenance. A run with no answer keeps its
 * outputs open, since they are its only content. A running run is unchanged.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://surface.test/" });

import { afterAll, describe, expect, test } from "bun:test";

let walk: Record<string, unknown> = {};
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = String(input);
  if (url.includes("/api/questions")) return new Response(JSON.stringify({ resolved: true, success: true, body: { questions: [] } }), { status: 200 });
  if (url.includes("/api/resolve")) return new Response(JSON.stringify({ resolved: true, shape: "goalWalkState", body: walk }), { status: 200 });
  return new Response("{}", { status: 200 });
}) as typeof fetch;
const uiSrc = new URL("../ui/src/", import.meta.url).pathname;
const from = (spec: string): string => Bun.resolveSync(spec, uiSrc);
const React = await import(from("react"));
const { createRoot } = await import(from("react-dom/client"));
const { act } = React;
const { QueryClient, QueryClientProvider } = await import(from("@tanstack/react-query"));
const { LiveControlsProvider } = await import("../ui/src/state/liveControls");
const { QuestionsProvider } = await import("../ui/src/state/questions");
const { RunView } = await import("../ui/src/components/RunView");
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
async function mount(): Promise<HTMLElement> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  await act(async () => {
    createRoot(el).render(React.createElement(QueryClientProvider, { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
      React.createElement(LiveControlsProvider, null, React.createElement(QuestionsProvider, null, React.createElement(RunView, { dispatchId: "d-f" })))));
  });
  for (let i = 0; i < 3; i++) await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
  return el;
}
afterAll(async () => {
  await GlobalRegistrator.unregister();
});
const search = JSON.stringify({ shape: "webSearchResult", query: "gas prices", results: [{ title: "State Gas Price Averages", url: "https://gasprices.aaa.com/state-gas-price-averages/", snippet: "National Average $4.3413" }] });
const base = {
  dispatchId: "d-f", goal: "What are the gas prices looking like?", poolShapes: [], pendingTargets: [], steps: [], walkTier: null, operator: "human-surface", trigger: null,
  humanGraded: false, humanReachNotes: null, requeueOf: null, learning: null, grounded: null, currentStep: null, completionShapes: null, executionPath: "fresh_derivation", attemptCount: 2,
  poolEvents: [
    { shape: "goal", source: "goal", at: 1000 }, { shape: "dispatch_id", source: "seed var dispatch_id", at: 1001 },
    { shape: "llm_completion_dispatch", source: "produced by satisfier:llm_completion_dispatch", at: 3000 },
    { shape: "goal", source: "goal", at: 30000 }, { shape: "dispatch_id", source: "seed var dispatch_id", at: 30001 },
    { shape: "webSearchResult", source: "produced by satisfier:webSearchResult", at: 35000 },
  ],
  walkLog: ["walk(/run-goal): HOLLOW — only links; β WITHHELD", "/run-goal: walk: FEEDBACK-RETRY — re-running the same chain with the prior verdict fed into synthesis"],
  poolProvenance: [
    { id: "g", shape: "goal", producedBy: "seed", contentPreview: "{\"goal\":\"gas\"}", chars: 14, consumedIds: [] },
    { id: "s", shape: "webSearchResult", producedBy: "satisfier:webSearchResult", contentPreview: search, chars: search.length, consumedIds: ["g"] },
  ],
};

describe("one fold", () => {
  test("must-fail: a finished run with an answer leads with it, and attempts, outputs and provenance sit in one closed fold", async () => {
    walk = { ...base, status: "completed", reached: true, goalReachReason: "Answered.", answerBody: "Regular is $4.34 a gallon on average (AAA)." };
    const el = await mount();
    const fold = el.querySelector("details.sf-how");
    expect(fold).not.toBeNull();
    expect(fold?.hasAttribute("open")).toBe(false);
    expect(fold?.querySelector("summary")?.textContent).toContain("How it went");
    expect(fold?.querySelector("[aria-label='Attempts']")).not.toBeNull();
    expect(fold?.querySelector("[aria-label='Outputs']")).not.toBeNull();
    expect(fold?.querySelector("[aria-label='Provenance']")).not.toBeNull();
    const answer = el.querySelector("[aria-label='Answer']")!;
    expect(answer.compareDocumentPosition(fold!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test("a finished run with no answer keeps its outputs open, above the fold", async () => {
    walk = { ...base, status: "completed", reached: false, goalReachReason: "The output provided links but did not summarize.", answerBody: null };
    const el = await mount();
    const fold = el.querySelector("details.sf-how")!;
    const outputs = el.querySelector("[aria-label='Outputs']")!;
    expect(fold.contains(outputs)).toBe(false);
    expect(fold.querySelector("[aria-label='Attempts']")).not.toBeNull();
  });

  test("a running run is not folded", async () => {
    walk = { ...base, status: "running", reached: null, goalReachReason: null, answerBody: null };
    const el = await mount();
    expect(el.querySelector("details.sf-how")).toBeNull();
  });
});
