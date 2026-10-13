/**
 * "Show as" on an output: one click redraws it in the chosen form at once and
 * posts a form_choice observation naming the shape, the form left and the form
 * chosen. Not offered on the blind calibration view.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://surface.test/" });

import { afterAll, describe, expect, test } from "bun:test";
import type { GoalWalkState } from "../ui/src/api/types";

const posted: Record<string, unknown>[] = [];
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  if (String(input).includes("/api/observations") && init?.method === "POST") posted.push(JSON.parse(String(init.body)));
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

const record = JSON.stringify({ query: "last cutover", results: [{ title: "Cutover notes", url: "u1" }, { title: "Release log", url: "u2" }] });
function walk(): GoalWalkState {
  return {
    dispatchId: "d", status: "completed", reached: true, goalReachReason: null, poolShapes: [], pendingTargets: [], poolEvents: [], walkLog: [],
    currentStep: null, steps: [], executionPath: null, walkTier: null, attemptCount: null, grounded: null, learning: null, answerBody: null,
    operator: null, completionShapes: null, humanGraded: false, humanReachNotes: null, trigger: null, requeueOf: null,
    poolProvenance: [
      { id: "g", shape: "goal", producedBy: "seed", contentPreview: "When was the last cutover?", chars: 26, consumedIds: [] },
      { id: "s", shape: "webSearchResult", producedBy: "satisfier:webSearchResult", contentPreview: record, chars: record.length, consumedIds: ["g"] },
    ],
  } as unknown as GoalWalkState;
}

async function mount(blind: boolean): Promise<HTMLElement> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    createRoot(el).render(React.createElement(QueryClientProvider, { client: qc }, React.createElement(LiveControlsProvider, null, React.createElement(Chain, { walk: walk(), blind }))));
  });
  await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
  return el;
}

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

describe("Show as", () => {
  test("a choice redraws the output and records a form_choice", async () => {
    const el = await mount(false);
    const out = el.querySelector(".sf-chain-output")!;
    const before = out.querySelector(".sf-rendered")?.getAttribute("data-form");
    const text = [...out.querySelectorAll("[aria-label='Show as'] button")].find((b) => b.textContent === "Text") as HTMLButtonElement;
    expect(text).toBeDefined();
    await act(async () => { text.click(); await new Promise((r) => setTimeout(r, 10)); });
    expect(out.querySelector(".sf-rendered")?.getAttribute("data-form")).toBe("text");
    const choice = posted.find((p) => p["obs_type"] === "form_choice");
    expect(choice).toMatchObject({ shape: "webSearchResult", form_from: before, form_to: "text" });
  });

  test("must-fail: not offered on the blind calibration view", async () => {
    const el = await mount(true);
    expect(el.querySelector("[aria-label='Show as']")).toBeNull();
  });
});

describe("Show as on a one-line row", () => {
  test("must-fail: an expanded row offers Show as, so a record can be asked for as a table", async () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const w = { ...walk(), reached: false } as GoalWalkState;
    await act(async () => {
      createRoot(el).render(React.createElement(QueryClientProvider, { client: qc }, React.createElement(LiveControlsProvider, null, React.createElement(Chain, { walk: w }))));
    });
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    const row = el.querySelector(".sf-chain-collapsed details");
    expect(row).not.toBeNull();
    expect(row?.querySelector("[aria-label='Show as']")).not.toBeNull();
  });
});
