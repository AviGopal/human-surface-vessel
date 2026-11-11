/**
 * The one box reads a message by the context beside it. With a question open and
 * unanswered, typing answers it (recorded on the question); otherwise it is a new
 * ask, written as a row. Shape: a question asked through the surface's human_input route.
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
  if (url.includes("/api/discovery/resolve")) return Response.json({ ok: true, seq: 300 });
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
const { boxContext, boxWords, NEW_ASK } = await import("../ui/src/lib/box");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: { unmount: () => void }[] = [];
/** Whether the box wrote `text` as the person's ask: one world_changed row through discovery. */
const asked = (text: string) =>
  calls.some((c) => c.url.includes("/api/discovery/resolve") && JSON.stringify(c.body["pointer"]) === JSON.stringify({ type: "record_write", row: { shape: "world_changed", what: text, input_refs: [] } }));
const wroteAnything = () => calls.some((c) => c.url.includes("/api/discovery/resolve"));
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
  run: { dispatchId: "d-run", solicitationId: "s-1", deadlineAt: null, linked: false },
} as never;

async function mount(props: Record<string, unknown>): Promise<HTMLElement> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const root = createRoot(el);
  roots.push(root);
  await act(async () => {
    root.render(
      React.createElement(QueryClientProvider, { client: qc }, React.createElement(LiveControlsProvider, null, React.createElement(QuestionsProvider, null, React.createElement(TopBar, { openIssues: null, onToggleIssues: () => {}, issuesOpen: false, ...props })))),
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
  test("an open question becomes the context, unless the person set it aside", () => {
    expect(boxContext(null, "x", null)).toEqual(NEW_ASK);
    expect(boxContext(question, "Where is it raining?", "solicitation-s-1")).toEqual(NEW_ASK);
    const ctx = boxContext(question, "Where is it raining?", null);
    expect(boxWords(ctx).chip).toBe("Answering “Where is it raining?” · waiting on you");
    expect(boxWords(NEW_ASK).chip).toBe("New ask");
  });

  test("must-fail: with a question open, typing answers it and asks nothing", async () => {
    const el = await mount({ context: boxContext(question, "Where is it raining?", null) });
    expect(el.querySelector(".sf-box-chip")?.textContent).toContain("Answering “Where is it raining?”");
    await type(el, "Seattle");
    const kept = calls.find((c) => c.url.includes("/api/participation"));
    expect(kept?.body).toMatchObject({ panel_id: "solicitation-s-1", kind: "answer", value: "Seattle" });
    expect(wroteAnything()).toBe(false);
    expect(el.querySelector(".sf-outcome-line")?.textContent).toBe("Answer×");
    expect(el.querySelector("textarea")?.value).toBe("");
  });

  test("with no context, typing is a new ask", async () => {
    const el = await mount({});
    expect(el.querySelector(".sf-box-chip")?.textContent).toBe("New ask");
    await type(el, "What time is it?");
    expect(asked("What time is it?")).toBe(true);
    expect(calls.some((c) => c.url.includes("/api/participation"))).toBe(false);
  });

  test("must-fail (G2, G3): \"not now\" declines and \"need more\" asks for more, and the record says it was read from those words", async () => {
    for (const [text, outcome, kind, echo] of [
      ["not now", "declined", "dismiss", "Declined×"],
      ["Need more.", "insufficient_context", "dismiss", "Need more×"],
    ] as const) {
      calls.length = 0;
      const el = await mount({ context: boxContext(question, "Where is it raining?", null) });
      await type(el, text);
      const kept = calls.find((c) => c.url.includes("/api/participation"));
      expect(kept?.body).toMatchObject({ kind, value: outcome, classified_by: "box-phrase", classified_phrase: text.toLowerCase().replace(/[.]$/, "") });
      expect(wroteAnything()).toBe(false);
      expect(el.querySelector(".sf-outcome-line")?.textContent).toBe(echo);
    }
  });

  test("G4: only those two exact phrases; anything else, these included, is an answer", async () => {
    for (const text of ["not now, try Seattle", "No", "I don't know", "skip", "decline", "what do you mean", "need more time to think: Seattle"]) {
      calls.length = 0;
      const el = await mount({ context: boxContext(question, "Where is it raining?", null) });
      await type(el, text);
      const kept = calls.find((c) => c.url.includes("/api/participation"));
      expect([text, kept?.body["kind"], kept?.body["value"]]).toEqual([text, "answer", text.trim()]);
      expect(kept?.body["classified_by"]).toBeUndefined();
    }
  });

  test("G5: with a question open, the box offers \"not now\" and \"need more\"; choosing one fills the box and sends nothing", async () => {
    const el = await mount({ context: boxContext(question, "Where is it raining?", null) });
    const chips = [...el.querySelectorAll(".sf-ask-suggest button")].map((b) => b.textContent);
    expect(chips).toEqual(["not now", "need more"]);
    await act(async () => {
      ([...el.querySelectorAll(".sf-ask-suggest button")].find((b) => b.textContent === "not now") as HTMLButtonElement).click();
    });
    expect(el.querySelector("textarea")?.value).toBe("not now");
    expect(calls.some((c) => c.url.includes("/api/participation"))).toBe(false);
  });

  test("× on the chip sets the question aside", async () => {
    let asideCalled = false;
    const el = await mount({ context: boxContext(question, "Where is it raining?", null), onSetAside: () => (asideCalled = true) });
    await act(async () => {
      (el.querySelector(".sf-box-chip button") as HTMLButtonElement).click();
    });
    expect(asideCalled).toBe(true);
  });

  test("must-fail: a presentation phrase typed while a question is open changes the display and answers nothing", async () => {
    intentApplies = true;
    const el = await mount({ context: boxContext(question, "Where is it raining?", null) });
    await type(el, "show search results as a table");
    expect(calls.some((c) => c.url.includes("/api/participation"))).toBe(false);
    expect(el.textContent).toContain("formByShape.webSearchResult → rows · for every webSearchResult output");
    intentApplies = false;
  });

  test("must-fail: a complaint prefix with nothing after it is not sent; it stays in the box", async () => {
    for (const text of ["hard to understand:", "Hard to see:  ", "wrong:"]) {
      calls.length = 0;
      const el = await mount({});
      await type(el, text);
      expect(wroteAnything() || calls.some((c) => c.url.includes("/api/feedback"))).toBe(false);
      expect(el.querySelector("textarea")!.value).toBe(text);
      expect(el.querySelector(".sf-outcome-line")?.textContent).toMatch(/^Say what's (hard to understand|hard to see|wrong)×$/);
    }
  });
});
