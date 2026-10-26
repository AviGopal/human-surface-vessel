/**
 * The one box reads a message by the context beside it. With the run on screen
 * waiting on the person, typing answers its question (the waiting run reads it);
 * otherwise it is a new ask. Shapes: a run asking through the surface's
 * human_input route (goal-host WS5), whose question carries its run link.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://surface.test/" });

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { teardownDom, trackRoot } from "./setup.ts";

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
  if (url.includes("/api/grade")) return new Response(JSON.stringify({ error: "scope verdict:human required" }), { status: 403 });
  if (url.includes("/api/run-goal")) return new Response(JSON.stringify({ accepted: true, dispatchId: "d-new" }), { status: 202 });
  return new Response(JSON.stringify({ resolved: true, success: true, body: {} }), { status: 200 });
}) as typeof fetch;

const uiSrc = new URL("../ui/src/", import.meta.url).pathname;
const React = await import(Bun.resolveSync("react", uiSrc));
const { createRoot: rawCreateRoot } = await import(Bun.resolveSync("react-dom/client", uiSrc));
const createRoot = (...a: Parameters<typeof rawCreateRoot>) => trackRoot(rawCreateRoot(...a));
const { act } = React;
const { QueryClient, QueryClientProvider } = await import(Bun.resolveSync("@tanstack/react-query", uiSrc));
const { LiveControlsProvider } = await import("../ui/src/state/liveControls");
const { QuestionsProvider } = await import("../ui/src/state/questions");
const { TopBar } = await import("../ui/src/components/TopBar");
const { boxContext, boxWords, NEW_ASK, readVerdictPhrase } = await import("../ui/src/lib/box");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: { unmount: () => void }[] = [];
afterAll(async () => {
  await teardownDom();
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
  const root = createRoot(el);
  roots.push(root);
  await act(async () => {
    root.render(
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
    expect(el.querySelector(".sf-outcome-line")?.textContent).toBe("Answer×");
    expect(el.querySelector("textarea")?.value).toBe("");
  });

  test("with no context, typing is a new ask", async () => {
    const el = await mount({});
    expect(el.querySelector(".sf-box-chip")?.textContent).toBe("New ask");
    await type(el, "What time is it?");
    expect(calls.some((c) => c.url.includes("/api/run-goal") && c.body["goal"] === "What time is it?")).toBe(true);
    expect(calls.some((c) => c.body["type"] === "solicitationResponse_write")).toBe(false);
  });

  test("must-fail (G2, G3): \"not now\" declines and \"need more\" asks for more, and the record says it was read from those words", async () => {
    for (const [text, outcome, kind, echo] of [
      ["not now", "declined", "dismiss", "Declined×"],
      ["Need more.", "insufficient_context", "dismiss", "Need more×"],
    ] as const) {
      calls.length = 0;
      const el = await mount({ context: boxContext(question, "Where is it raining?", null) });
      await type(el, text);
      const answer = calls.find((c) => c.body["type"] === "solicitationResponse_write");
      expect(answer?.body).toMatchObject({ solicitationId: "s-1", outcome });
      const kept = calls.find((c) => c.url.includes("/api/participation"));
      expect(kept?.body).toMatchObject({ kind, value: outcome, classified_by: "box-phrase", classified_phrase: text.toLowerCase().replace(/[.]$/, "") });
      expect(calls.some((c) => c.url.includes("/api/run-goal"))).toBe(false);
      expect(el.querySelector(".sf-outcome-line")?.textContent).toBe(echo);
    }
  });

  test("G4: only those two exact phrases; anything else, these included, is an answer", async () => {
    for (const text of ["not now, try Seattle", "No", "I don't know", "skip", "decline", "what do you mean", "need more time to think: Seattle"]) {
      calls.length = 0;
      const el = await mount({ context: boxContext(question, "Where is it raining?", null) });
      await type(el, text);
      const answer = calls.find((c) => c.body["type"] === "solicitationResponse_write");
      expect([text, answer?.body["outcome"]]).toEqual([text, "answered"]);
      const kept = calls.find((c) => c.url.includes("/api/participation"));
      expect(kept?.body["classified_by"]).toBeUndefined();
    }
  });

  test("G5: with a run waiting, the box offers \"not now\" and \"need more\"; choosing one fills the box and sends nothing", async () => {
    const el = await mount({ context: boxContext(question, "Where is it raining?", null) });
    const chips = [...el.querySelectorAll(".sf-ask-suggest button")].map((b) => b.textContent);
    expect(chips).toEqual(["not now", "need more"]);
    await act(async () => {
      ([...el.querySelectorAll(".sf-ask-suggest button")].find((b) => b.textContent === "not now") as HTMLButtonElement).click();
    });
    expect(el.querySelector("textarea")?.value).toBe("not now");
    expect(calls.some((c) => c.body["type"] === "solicitationResponse_write" || c.url.includes("/api/participation"))).toBe(false);
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

  test("must-fail: with an input chosen to supply, the box adds it to that run and starts nothing else", async () => {
    const el = await mount({ context: boxContext(null, null, null, { dispatchId: "d-run", shape: "human_input" }) });
    expect(el.querySelector(".sf-box-chip")?.textContent).toContain("Supplying human_input to this run");
    await type(el, "Seattle");
    const added = calls.find((c) => c.body["type"] === "poolImpulse_write");
    expect(added?.body).toMatchObject({ dispatchId: "d-run", shape: "human_input", content: "Seattle" });
    expect(calls.some((c) => c.url.includes("/api/run-goal") || c.body["type"] === "solicitationResponse_write")).toBe(false);
    expect(el.textContent).toContain("Read as human_input for this run · added to the run");
  });

  test("a run's open question comes before a chosen input", () => {
    expect(boxContext(question, "g", null, { dispatchId: "d-run", shape: "human_input" }).kind).toBe("reply");
  });

  test("only a few exact phrases are verdicts", () => {
    expect(readVerdictPhrase("That worked!")).toBe("achieved");
    expect(readVerdictPhrase("correct")).toBe("achieved");
    expect(readVerdictPhrase("Wrong answer.")).toBe("not_achieved");
    expect(readVerdictPhrase("that didn't work")).toBe("not_achieved");
    expect(readVerdictPhrase("is that right?")).toBeNull();
    expect(readVerdictPhrase("what worked last time")).toBeNull();
  });

  const outcome = { dispatchId: "d-done", executionId: "e-done", goal: "Where is it raining?", judgeReached: true };

  test("must-fail: with a finished run on screen, a verdict phrase is kept as a verdict, even when the corpus refuses it", async () => {
    const el = await mount({ context: boxContext(null, null, null, null, outcome) });
    await type(el, "wrong answer");
    const g = calls.find((c) => c.url.includes("/api/grade"));
    expect(g?.body).toMatchObject({ execution_id: "e-done", dispatch_id: "d-done", verdict: "not_achieved", judge_reached: true, notes: "wrong answer" });
    expect(calls.some((c) => c.url.includes("/api/run-goal"))).toBe(false);
    expect(el.textContent).toContain("Read as your verdict on this run: not reached · kept on the run; the learning corpus didn't take it yet");
  });

  test("must-fail: a complaint prefix with nothing after it is not sent; it stays in the box", async () => {
    for (const text of ["hard to understand:", "Hard to see:  ", "wrong:"]) {
      calls.length = 0;
      const el = await mount({ context: boxContext(null, null, null, null, outcome) });
      await type(el, text);
      expect(calls.some((c) => c.url.includes("/api/run-goal") || c.url.includes("/api/feedback") || c.url.includes("/api/grade"))).toBe(false);
      expect(el.querySelector("textarea")!.value).toBe(text);
      expect(el.querySelector(".sf-outcome-line")?.textContent).toMatch(/^Say what's (hard to understand|hard to see|wrong)×$/);
    }
  });

  test("with a finished run on screen, anything else is still a new ask", async () => {
    const el = await mount({ context: boxContext(null, null, null, null, outcome) });
    await type(el, "What time is it in Bergen?");
    expect(calls.some((c) => c.url.includes("/api/run-goal") && c.body["goal"] === "What time is it in Bergen?")).toBe(true);
    expect(calls.some((c) => c.url.includes("/api/grade"))).toBe(false);
  });
});
