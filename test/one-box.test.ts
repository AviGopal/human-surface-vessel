/**
 * The one box reads a message by the context beside it. With the run on screen
 * waiting on the person, typing answers its question (the waiting run reads it);
 * otherwise it is a new ask. Shapes: a run asking through the surface's
 * human_input route (goal-host WS5), whose question carries its run link.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://surface.test/" });

import { afterAll, beforeEach, describe, expect, test } from "bun:test";

const calls: { url: string; body: Record<string, unknown> }[] = [];
let intentApplies = false;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
  } catch {
    /* not json */
  }
  calls.push({ url, body });
  if (url.includes("/api/surface-intent")) {
    return intentApplies
      ? new Response(JSON.stringify({ applied: true, changes: [{ field: "formByShape.webSearchResult", from: "prose", to: "rows" }], unparsed: [], policy: { revision: 9 } }), { status: 200 })
      : new Response(JSON.stringify({ applied: false, unparsed: [] }), { status: 422 });
  }
  if (url.includes("/api/participation")) {
    return new Response(JSON.stringify({ resolved: true, success: true, body: { id: body["response_id"], panelId: body["panel_id"], panelRevision: body["panel_revision"] } }), { status: 200 });
  }
  if (url.includes("/api/questions")) return new Response(JSON.stringify({ resolved: true, success: true, body: { questions: [] } }), { status: 200 });
  if (url.includes("/api/run-goal")) return new Response(JSON.stringify({ accepted: true, dispatchId: "d-new" }), { status: 202 });
  return new Response(JSON.stringify({ resolved: true, success: true, body: {} }), { status: 200 });
}) as typeof fetch;

const uiSrc = new URL("../ui/src/", import.meta.url).pathname;
const React = await import(Bun.resolveSync("react", uiSrc));
const { createRoot } = await import(Bun.resolveSync("react-dom/client", uiSrc));
const { act } = React;
const { QueryClient, QueryClientProvider } = await import(Bun.resolveSync("@tanstack/react-query", uiSrc));
const { LiveControlsProvider } = await import("../ui/src/state/liveControls");
const { QuestionsProvider } = await import("../ui/src/state/questions");
const { TopBar } = await import("../ui/src/components/TopBar");
const { boxContext, boxWords, NEW_ASK } = await import("../ui/src/lib/box");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterAll(async () => {
  await GlobalRegistrator.unregister();
});
beforeEach(() => {
  calls.length = 0;
});

const question = {
  id: "solicitation-s-1",
  revision: 1,
  title: "The substrate needs your input",
  body: "## The substrate needs your input\n\n> Where should it look?",
  createdAt: 0,
  updatedAt: 0,
  responses: [],
  answered: false,
  declined: false,
  run: { dispatchId: "d-run", solicitationId: "s-1", deadlineAt: null, linked: true },
} as never;

async function mount(props: Record<string, unknown>): Promise<HTMLElement> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    createRoot(el).render(
      React.createElement(QueryClientProvider, { client: qc }, React.createElement(LiveControlsProvider, null, React.createElement(QuestionsProvider, null, React.createElement(TopBar, { onDispatched: () => {}, openIssues: null, onToggleIssues: () => {}, issuesOpen: false, ...props })))),
    );
  });
  return el;
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
  for (let i = 0; i < 3; i++) await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
}

describe("one box", () => {
  test("a run's open question becomes the context, unless the person set it aside", () => {
    expect(boxContext(null, "x", null)).toEqual(NEW_ASK);
    expect(boxContext(question, "Where is it raining?", "solicitation-s-1")).toEqual(NEW_ASK);
    const ctx = boxContext(question, "Where is it raining?", null);
    expect(boxWords(ctx).chip).toBe("Answering “Where is it raining?” · waiting on you");
    expect(boxWords(NEW_ASK).chip).toBe("New ask");
  });

  test("must-fail: with the run waiting on the person, typing answers its question and starts no run", async () => {
    const el = await mount({ context: boxContext(question, "Where is it raining?", null) });
    expect(el.querySelector(".sf-box-chip")?.textContent).toContain("Answering “Where is it raining?”");
    await type(el, "Seattle");
    const answer = calls.find((c) => c.body["type"] === "solicitationResponse_write");
    expect(answer?.body).toMatchObject({ solicitationId: "s-1" });
    expect(JSON.stringify(answer?.body)).toContain("Seattle");
    expect(calls.some((c) => c.url.includes("/api/participation"))).toBe(true);
    expect(calls.some((c) => c.url.includes("/api/run-goal"))).toBe(false);
    expect(el.textContent).toContain("Read as your answer to “Where is it raining?” · delivered");
    expect(el.querySelector("textarea")?.value).toBe("");
  });

  test("with no context, typing is a new ask", async () => {
    const el = await mount({});
    expect(el.querySelector(".sf-box-chip")?.textContent).toBe("New ask");
    await type(el, "What time is it?");
    expect(calls.some((c) => c.url.includes("/api/run-goal") && c.body["goal"] === "What time is it?")).toBe(true);
    expect(calls.some((c) => c.body["type"] === "solicitationResponse_write")).toBe(false);
  });

  test("× on the chip sets the question aside", async () => {
    let asideCalled = false;
    const el = await mount({ context: boxContext(question, "Where is it raining?", null), onSetAside: () => (asideCalled = true) });
    await act(async () => {
      (el.querySelector(".sf-box-chip button") as HTMLButtonElement).click();
    });
    expect(asideCalled).toBe(true);
  });

  test("must-fail: a presentation phrase typed while a run waits changes the display and sends nothing to the run", async () => {
    intentApplies = true;
    const el = await mount({ context: boxContext(question, "Where is it raining?", null) });
    await type(el, "show search results as a table");
    expect(calls.some((c) => c.body["type"] === "solicitationResponse_write")).toBe(false);
    expect(calls.some((c) => c.url.includes("/api/participation"))).toBe(false);
    expect(el.textContent).toContain("formByShape.webSearchResult → rows · for every webSearchResult output");
    intentApplies = false;
  });
});
