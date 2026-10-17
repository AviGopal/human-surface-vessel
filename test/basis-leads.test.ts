/**
 * A reached run whose outputs have expired leads with the record its answer was
 * reasoned from. Shape: run 3faa95f3 (10-14), "What is happening today?":
 * reached, outputs no longer kept, and the news it found survived only as a
 * cut "## Basis" under a verdict-only answer, folded shut.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://surface.test/" });

import { afterAll, describe, expect, test } from "bun:test";

const GOAL = "What is happening today?";
const REASON = "The output provides relevant news articles related to events occurring today, fulfilling the intent of the goal.";
const search = JSON.stringify({
  shape: "webSearchResult",
  query: "What's happening today?",
  results: [
    { title: "Russian strikes leave 600,000 without power in Ukraine", url: "https://www.bbc.com/news/articles/cm2d6e62p49do", snippet: "in Ukraine. Meanwhile, the Russian defence ministry said..." },
    { title: "Houthis launch fresh wave of missiles across Saudi Arabia", url: "https://www.dw.com/en/saudi-arabia-houthis-yemen-war-missile-strikes-aramco-riyadh/live-79655805", snippet: "Author: Felix Tamsut" },
    { title: "Cut entry", url: "https://cut.example/x" },
  ],
}).slice(0, 520);
const DID = "3faa95f3-6c14-4e76-af90-b11e5f338689";
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
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    createRoot(el).render(React.createElement(QueryClientProvider, { client: qc }, React.createElement(LiveControlsProvider, null, React.createElement(QuestionsProvider, null, React.createElement(RunView, { dispatchId: DID })))));
  });
  for (let i = 0; i < 3; i++) await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
  return el;
}

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

const base = {
  dispatchId: DID, goal: GOAL, status: "completed", reached: true, goalReachReason: REASON,
  poolShapes: [], pendingTargets: [], poolEvents: [], walkLog: [], steps: [], poolProvenance: [],
  executionPath: "fresh_derivation", walkTier: "fresh_derivation", attemptCount: 2, operator: "human-surface", trigger: null,
  humanGraded: false, humanReachNotes: null, requeueOf: null, learning: null, grounded: null, currentStep: null, completionShapes: null,
};

describe("a reached run whose outputs expired", () => {
  test("must-fail: the basis leads as the answer, drawn as links, and is not drawn twice", async () => {
    walk = { ...base, answerBody: `# ${GOAL}\n${REASON}\n## Basis\n\n${DID}\n\n${search}` };
    const el = await mount();
    const answer = el.querySelector("[aria-label='Answer']");
    expect(answer).not.toBeNull();
    const hrefs = [...answer!.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("https://www.bbc.com/news/articles/cm2d6e62p49do");
    const verdict = el.querySelector("[aria-label='Verdict']");
    expect(verdict?.className).toContain("sf-verdict-compact");
    expect(verdict?.querySelector("details.sf-answer-basis")).toBeNull();
    expect(answer!.compareDocumentPosition(verdict!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test("a run that did not reach keeps its basis folded under the verdict", async () => {
    walk = { ...base, reached: false, answerBody: `# ${GOAL}\n${REASON}\n## Basis\n\n${DID}\n\n${search}` };
    const el = await mount();
    expect(el.querySelector("[aria-label='Answer']")).toBeNull();
  });
});
