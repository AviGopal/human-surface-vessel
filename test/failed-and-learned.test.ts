/**
 * On a run that did not reach: what its own records declare failed leads the
 * outputs, in their own words ("failed" for an error, "rejected" only for
 * action:"rejected"); and a form a person pinned or the learner learned opens
 * whatever it is. Shapes from 8274edea / 2b0ee526 (10-13).
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://surface.test/" });

import { afterAll, describe, expect, test } from "bun:test";
import type { GoalWalkState } from "../ui/src/api/types";

let learned: Record<string, string> = {};
globalThis.fetch = (async (input: RequestInfo | URL) => {
  if (String(input).includes("/api/render-policy")) {
    return new Response(JSON.stringify({ tokenOverrides: {}, formByShape: {}, learnedFormByShape: learned, maxPreviewChars: null, ledgerDefaultExpanded: true, revision: 1, updatedAt: 0, note: null }), { status: 200 });
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
const { Chain } = await import("../ui/src/components/Chain");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SEARCH = JSON.stringify({ shape: "webSearchResult", query: "Check the headlines on https://apnews.com/", results: [{ title: "Associated Press News: Breaking News, Latest Headlines", url: "https://apnews.com/" }] });
const LLM_FAIL = JSON.stringify({ resolved: false, shape: "llmCompletion", error: "body must include non-empty 'prompt' string" });

function walk(): GoalWalkState {
  return {
    dispatchId: "d", status: "failed", reached: false, goalReachReason: "no substantive content", poolShapes: [], pendingTargets: [], poolEvents: [], walkLog: [],
    currentStep: null, steps: [], executionPath: null, walkTier: null, attemptCount: null, grounded: null, learning: null, answerBody: null,
    operator: null, completionShapes: null, humanGraded: false, humanReachNotes: null, trigger: null, requeueOf: null,
    poolProvenance: [
      { id: "g", shape: "goal", producedBy: "seed", contentPreview: "Check the headlines", chars: 19, consumedIds: [] },
      { id: "s", shape: "webSearchResult", producedBy: "activity:⟨learned-composition-web-search-to-llm-completion⟩", contentPreview: SEARCH, chars: 3094, consumedIds: ["g"] },
      { id: "l", shape: "llm_completion", producedBy: "activity:⟨learned-composition-web-search-to-llm-completion⟩", contentPreview: LLM_FAIL, chars: 856, consumedIds: [] },
    ],
  } as unknown as GoalWalkState;
}

async function mount(): Promise<HTMLElement> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    createRoot(el).render(React.createElement(QueryClientProvider, { client: qc }, React.createElement(LiveControlsProvider, null, React.createElement(Chain, { walk: walk() }))));
  });
  for (let i = 0; i < 3; i++) await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
  return el;
}

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

describe("declared failures", () => {
  test("must-fail: they lead the outputs, labelled failed, in the record's own words", async () => {
    learned = {};
    const el = await mount();
    const outputs = el.querySelector("[aria-label='Outputs']")!;
    const first = outputs.querySelector("details, article, ul");
    expect(first?.className).toContain("sf-chain-failed");
    const row = first?.querySelector("summary + ul summary")?.textContent ?? first?.textContent ?? "";
    expect(row).toContain("failed");
    expect(row).toContain("body must include non-empty 'prompt' string");
    expect(row).not.toContain("rejected");
  });
});

describe("a learned form", () => {
  test("must-fail: a record with a learned form leads open; without it, it stays a row", async () => {
    learned = { webSearchResult: "rows" };
    const withLearned = await mount();
    expect([...withLearned.querySelectorAll(".sf-chain-output")].some((a) => (a.textContent ?? "").includes("Associated Press"))).toBe(true);
    learned = {};
    const without = await mount();
    expect([...without.querySelectorAll(".sf-chain-output")].some((a) => (a.textContent ?? "").includes("Associated Press"))).toBe(false);
  });
});
