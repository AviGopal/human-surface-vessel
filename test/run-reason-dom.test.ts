/**
 * The run page under a person's override, drawn through RunView and the
 * planner. goal-host writes the reason as `[human override: <the person's
 * words>] <the judge's reason>`; drawn whole, the leading bracket made the
 * planner read it as structured data and set it as code, and the person's words
 * appeared twice. Nothing here imports the split, so it fails on what the page
 * draws wherever the split is absent.
 *
 * Shape: one node 10-26, a gap-closing edit run graded "Failed for a different reason".
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://surface.test/" });

import { afterAll, describe, expect, test } from "bun:test";
import { teardownDom, trackRoot } from "./setup.ts";

let walk: Record<string, unknown> = {};
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = String(input);
  if (url.includes("/api/questions")) return new Response(JSON.stringify({ resolved: true, success: true, body: { questions: [] } }), { status: 200 });
  if (url.includes("/api/resolve")) return new Response(JSON.stringify({ resolved: true, shape: "goalWalkState", body: walk }), { status: 200 });
  return new Response("{}", { status: 200 });
}) as typeof fetch;

const uiSrc = new URL("../ui/src/", import.meta.url).pathname;
const React = await import(Bun.resolveSync("react", uiSrc));
const { createRoot: rawCreateRoot } = await import(Bun.resolveSync("react-dom/client", uiSrc));
const createRoot = (...a: Parameters<typeof rawCreateRoot>) => trackRoot(rawCreateRoot(...a));
const { act } = React;
const { QueryClient, QueryClientProvider } = await import(Bun.resolveSync("@tanstack/react-query", uiSrc));
const { LiveControlsProvider } = await import("../ui/src/state/liveControls");
const { QuestionsProvider } = await import("../ui/src/state/questions");
const { RunView } = await import("../ui/src/components/RunView");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterAll(async () => {
  await teardownDom();
});

async function mountRun(over: Record<string, unknown>): Promise<HTMLElement> {
  walk = {
    dispatchId: "d-override", goal: "Close a gap", status: "completed", reached: false, goalReachReason: null, poolShapes: [], poolProvenance: [],
    pendingTargets: [], poolEvents: [], walkLog: [], currentStep: null, steps: [], executionPath: null, walkTier: null,
    attemptCount: null, grounded: null, learning: null, answerBody: null, operator: "lane", completionShapes: null,
    humanGraded: true, humanReachNotes: null, trigger: null, requeueOf: null, ...over,
  };
  const el = document.createElement("div");
  document.body.appendChild(el);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    createRoot(el).render(
      React.createElement(QueryClientProvider, { client: qc },
        React.createElement(LiveControlsProvider, null, React.createElement(QuestionsProvider, null, React.createElement(RunView, { dispatchId: "d-override" })))),
    );
  });
  for (let i = 0; i < 3; i++) await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
  return el;
}

const JUDGE = "early edit-intent routed to feature_compose; refused at admission (stage=ineligible): the gap is not compose work, so it is neither walked nor escalated";
const REASON = `[human override: Failed for a different reason — Shouldn't use feature_compose] ${JUDGE}`;


describe("the run page under a person's override", () => {
  const PERSON = "Failed for a different reason — Shouldn't use feature_compose";
  const count = (hay: string, needle: string): number => hay.split(needle).length - 1;
  // Drawn as words (a paragraph, or one line), never as verbatim code ("text") or structured data.
  const AS_WORDS = ["prose", "scalar"];

  test("must-fail: the judge's reason is drawn as words, and the person's words appear once", async () => {
    const el = await mountRun({ goalReachReason: REASON, humanReachNotes: PERSON });
    const header = el.querySelector(".sf-view-head")!;
    expect(AS_WORDS).toContain(header.querySelector(".sf-run-reason-full [data-form]")?.getAttribute("data-form") ?? "none");
    expect(header.textContent).toContain("refused at admission");
    expect(count(header.textContent ?? "", PERSON)).toBe(1);
  });

  test("must-fail: with no kept notes, the person's words come from the override, once", async () => {
    const el = await mountRun({ goalReachReason: "[human override: not_achieved] the judge found no output for the target", humanReachNotes: null });
    const header = el.querySelector(".sf-view-head")!;
    expect(AS_WORDS).toContain(header.querySelector(".sf-run-reason-full [data-form]")?.getAttribute("data-form") ?? "none");
    expect(count(header.textContent ?? "", "not_achieved")).toBe(1);
    expect(header.textContent).not.toContain("[human override");
  });
});
