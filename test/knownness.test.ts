/**
 * Verified or learned content is drawn apart from everything else, decided only
 * from fields the run reports. Shapes (10-14/15): the 6211*37 run reached on a
 * deterministic check; the sunset runs' inference returned no target; a news
 * summary reached by the model judge alone, which is neither.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://surface.test/" });

import { afterAll, describe, expect, test } from "bun:test";
import { teardownDom, trackRoot } from "./setup.ts";
import { knownness } from "../ui/src/lib/knownness";

const EMPTY = '[goal-host-vessel] /run-goal: goal-target inference {"goal_hash":"86a4dcc0","inferred_target_shapes":[],"confidence":0,"alternatives":[]}';
const FOUND = '[goal-host-vessel] /run-goal: goal-target inference {"goal_hash":"x","inferred_target_shapes":["shellResult"],"confidence":0.9,"alternatives":[]}';
const w = (o: Record<string, unknown>) => ({ reached: null, goalReachReason: null, executionPath: null, walkLog: [], ...o }) as never;

describe("knownness", () => {
  test("a deterministic check is verified; a landing found in git is verified", () => {
    expect(knownness(w({ reached: true, goalReachReason: "deterministic:transform-verified — product(6211*37) = 229807 found in produced content" }))).toBe("verified");
    expect(knownness(w({ reached: true, goalReachReason: "deterministic:early-edit-intent-landed — landed 751a75a" }))).toBe("verified");
  });
  test("a recorded pathway is learned", () => {
    expect(knownness(w({ reached: true, executionPath: "learned_pathway", goalReachReason: "The output fulfils the goal." }))).toBe("learned");
  });
  test("must-fail: an empty inference is not understood, even if the judge said reached", () => {
    expect(knownness(w({ reached: true, walkLog: [EMPTY], goalReachReason: "fine" }))).toBe("not-understood");
  });
  test("a judge's prose verdict alone is unknown, never verified", () => {
    expect(knownness(w({ reached: true, walkLog: [FOUND], goalReachReason: "The output provides relevant news articles" }))).toBe("unknown");
    expect(knownness(w({ reached: false, goalReachReason: "deterministic:transform-mismatch — 229807 not found" }))).toBe("unknown");
  });
});

globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = String(input);
  if (url.includes("/api/questions")) return new Response(JSON.stringify({ resolved: true, success: true, body: { questions: [] } }), { status: 200 });
  if (url.includes("/api/resolve")) return new Response(JSON.stringify({ resolved: true, shape: "goalWalkState", body: walk }), { status: 200 });
  return new Response("{}", { status: 200 });
}) as typeof fetch;
let walk: Record<string, unknown> = {};
const uiSrc = new URL("../ui/src/", import.meta.url).pathname;
const from = (spec: string): string => Bun.resolveSync(spec, uiSrc);
const React = await import(from("react"));
const { createRoot: rawCreateRoot } = await import(from("react-dom/client"));
const createRoot = (...a: Parameters<typeof rawCreateRoot>) => trackRoot(rawCreateRoot(...a));
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
      React.createElement(LiveControlsProvider, null, React.createElement(QuestionsProvider, null, React.createElement(RunView, { dispatchId: "d-k" })))));
  });
  for (let i = 0; i < 3; i++) await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
  return el;
}
afterAll(async () => {
  await teardownDom();
});
const base = { dispatchId: "d-k", goal: "g", status: "completed", poolShapes: [], pendingTargets: [], poolEvents: [], steps: [], poolProvenance: [], walkTier: null, attemptCount: 1, operator: "human-surface", trigger: null, humanGraded: false, humanReachNotes: null, requeueOf: null, learning: null, grounded: null, currentStep: null, completionShapes: null };

describe("drawn", () => {
  test("a verified answer is marked, an unknown one is not", async () => {
    walk = { ...base, reached: true, executionPath: "fresh_derivation", walkLog: [FOUND], goalReachReason: "deterministic:transform-verified — 229807 found", answerBody: "The product of 6211 and 37 is 229807." };
    const v = await mount();
    expect(v.querySelector("[aria-label='Answer']")?.getAttribute("data-known")).toBe("verified");
    expect(v.querySelector("[aria-label='Answer']")?.textContent).toContain("verified by a check");
    walk = { ...base, reached: true, executionPath: "fresh_derivation", walkLog: [FOUND], goalReachReason: "The output provides news", answerBody: "Today: three stories." };
    const u = await mount();
    expect(u.querySelector("[aria-label='Answer']")?.getAttribute("data-known")).toBe("unknown");
    expect(u.querySelector(".sf-known-label")).toBeNull();
  });
  test("must-fail: a run that did not understand says so under its reason", async () => {
    walk = { ...base, reached: false, executionPath: "fresh_derivation", walkLog: [EMPTY], goalReachReason: "The output does not provide a sunset time.", answerBody: null };
    const el = await mount();
    expect(el.querySelector(".sf-known-line")?.textContent).toContain("Didn't understand the question");
  });
});
