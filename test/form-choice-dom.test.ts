/**
 * The box carries what "Show as" did (16f-1, user ruling 10-19). "show this as a
 * table" redraws the run's lead answer at once and posts the same form_choice
 * observation a click on "Show as" posted, marked as from the box. No output
 * draws a "Show as" group any more. An unrelated ask posts nothing and is sent
 * once; a reading the screen can't take is refused in a few words.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://surface.test/" });

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { teardownDom, trackRoot } from "./setup.ts";
import type { GoalWalkState } from "../ui/src/api/types";

const posted: Record<string, unknown>[] = [];
const goals: Record<string, unknown>[] = [];
const intents: Record<string, unknown>[] = [];
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  const body = (() => {
    try {
      return JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    } catch {
      return {};
    }
  })();
  if (url.includes("/api/observations") && init?.method === "POST") posted.push(body);
  if (url.includes("/api/run-goal")) {
    goals.push(body);
    return new Response(JSON.stringify({ accepted: true, dispatchId: "d-new" }), { status: 202 });
  }
  if (url.includes("/api/surface-intent")) {
    intents.push(body);
    // The server's reading (test/view-intent.test.ts pins it); here, its answers as the page receives them.
    if (body["instruction"] === "show this as a table") return new Response(JSON.stringify({ applied: false, understood: true, view: { shape: "webSearchResult", form: "rows", region: "run_answer" } }), { status: 200 });
    if (body["instruction"] === "show this as a page") return new Response(JSON.stringify({ applied: false, understood: true, refused: { reason: "Not a page" } }), { status: 200 });
    return new Response(JSON.stringify({ applied: false, unparsed: [] }), { status: 422 });
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
const { QuestionsProvider } = await import("../ui/src/state/questions");
const { OnScreenProvider } = await import("../ui/src/state/onScreen");
const { Chain } = await import("../ui/src/components/Chain");
const { Rendered } = await import("../ui/src/components/Rendered");
const { TopBar } = await import("../ui/src/components/TopBar");
const { fromText } = await import("../ui/src/lib/content");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: { unmount: () => void }[] = [];
afterAll(async () => {
  await teardownDom();
});
beforeEach(() => {
  posted.length = 0;
  goals.length = 0;
  intents.length = 0;
});

const record = JSON.stringify({ query: "last cutover", results: [{ title: "Cutover notes", url: "u1" }, { title: "Release log", url: "u2" }] });
function walk(reached: boolean): GoalWalkState {
  return {
    dispatchId: "d", status: "completed", reached, goalReachReason: null, poolShapes: [], pendingTargets: [], poolEvents: [], walkLog: [],
    currentStep: null, steps: [], executionPath: null, walkTier: null, attemptCount: null, grounded: null, learning: null, answerBody: null,
    operator: null, completionShapes: null, humanGraded: false, humanReachNotes: null, trigger: null, requeueOf: null,
    poolProvenance: [
      { id: "g", shape: "goal", producedBy: "seed", contentPreview: "When was the last cutover?", chars: 26, consumedIds: [] },
      { id: "s", shape: "webSearchResult", producedBy: "satisfier:webSearchResult", contentPreview: record, chars: record.length, consumedIds: ["g"] },
    ],
  } as unknown as GoalWalkState;
}

async function render(node: unknown): Promise<HTMLElement> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const root = createRoot(el);
  roots.push(root);
  await act(async () => {
    root.render(
      React.createElement(QueryClientProvider, { client: qc }, React.createElement(LiveControlsProvider, null, React.createElement(QuestionsProvider, null, React.createElement(OnScreenProvider, null, node)))),
    );
  });
  await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
  return el;
}

/** The box above a run's lead answer, as the run page draws it. */
async function boxOverAnswer(): Promise<HTMLElement> {
  return render(
    React.createElement(React.Fragment, null,
      React.createElement(TopBar, { onDispatched: () => {}, openIssues: null, onToggleIssues: () => {}, issuesOpen: false }),
      React.createElement("section", { "aria-label": "Answer" }, React.createElement(Rendered, { content: fromText("webSearchResult", record), density: "full", header: false, region: "run_answer", lead: true })),
    ),
  );
}

async function type(el: HTMLElement, text: string): Promise<void> {
  const box = el.querySelector("textarea")!;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!;
    setter.call(box, text);
    box.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  for (let i = 0; i < 4; i++) await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
}

const lead = (el: HTMLElement) => el.querySelector("[aria-label='Answer'] .sf-rendered");
const statusLines = (el: HTMLElement) => [...el.querySelectorAll(".sf-outcome-line")].map((l) => l.textContent ?? "");

describe("the box carries Show as", () => {
  test("must-fail (F6): no output draws a Show as group, blind or not, open or as a row", async () => {
    for (const reached of [true, false]) {
      for (const blind of [false, true]) {
        const el = await render(React.createElement(Chain, { walk: walk(reached), blind }));
        expect(el.querySelector("[aria-label='Show as']")).toBeNull();
        expect(el.querySelector(".sf-form-choice")).toBeNull();
      }
    }
  });

  test("must-fail (F2, F7): \"show this as a table\" redraws the lead answer and records one choice, from the box", async () => {
    const el = await boxOverAnswer();
    const before = lead(el)?.getAttribute("data-form");
    expect(before).not.toBe("rows");
    await type(el, "show this as a table");
    expect(intents[0]?.["onScreen"]).toMatchObject({ shape: "webSearchResult", form: before, region: "run_answer" });
    expect(lead(el)?.getAttribute("data-form")).toBe("rows");
    const choices = posted.filter((p) => p["obs_type"] === "form_choice");
    expect(choices).toEqual([{ obs_type: "form_choice", visibility: "operator_only", shape: "webSearchResult", form_from: before, form_to: "rows", region: "run_answer", origin: "box" }]);
    expect(goals).toEqual([]);
    expect(statusLines(el)).toContain("Display: table×");
    expect(statusLines(el).some((l) => l.includes("Interface changed"))).toBe(false);
    expect(el.querySelector("textarea")!.value).toBe("");
  });

  test("F3, F1: anything else is a goal, sent once, and records no choice", async () => {
    for (const text of ["what time is it", "Render apnews.com as a webpage."]) {
      goals.length = 0;
      posted.length = 0;
      const el = await boxOverAnswer();
      const before = lead(el)?.getAttribute("data-form");
      await type(el, text);
      expect(goals.length).toBe(1);
      expect(goals[0]).toMatchObject({ goal: text });
      expect(goals[0]).not.toHaveProperty("onScreen");
      expect(posted.filter((p) => p["obs_type"] === "form_choice")).toEqual([]);
      expect(lead(el)?.getAttribute("data-form")).toBe(before);
    }
  });

  test("F4: a reading the screen can't take says so, records no choice, and sends nothing", async () => {
    const el = await boxOverAnswer();
    const before = lead(el)?.getAttribute("data-form");
    await type(el, "show this as a page");
    expect(statusLines(el)).toContain("Not a page×");
    expect(posted.filter((p) => p["obs_type"] === "form_choice")).toEqual([]);
    expect(goals).toEqual([]);
    expect(lead(el)?.getAttribute("data-form")).toBe(before);
  });
});
