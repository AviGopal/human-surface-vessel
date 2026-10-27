/**
 * A message in two parts, typed on a run's outcome: a reached verdict and a request
 * after it. The verdict is recorded on the run and the request goes out as an ask of
 * its own; a not-reached verdict with its reason sends no ask.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://surface.test/" });

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { teardownDom, trackRoot } from "./setup.ts";

let available = true;
let signedIn = true;
const calls: { url: string; body: Record<string, unknown> }[] = [];
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
  } catch {
    /* not json */
  }
  calls.push({ url, body });
  const person = { userId: "user:alex", name: "Alex", email: "alex@example.test", expiresAt: Date.now() + 900_000 };
  if (url.endsWith("/api/session")) return Response.json({ available, signedIn, ...(signedIn ? { person } : {}) });
  if (url.endsWith("/api/session/login")) {
    signedIn = true;
    return Response.json({ signedIn: true, person });
  }
  if (url.endsWith("/api/session/logout")) {
    signedIn = false;
    return Response.json({ signedIn: false });
  }
  if (url.endsWith("/api/surface-intent")) return new Response("{}", { status: 422 });
  if (url.endsWith("/api/run-goal")) return Response.json({ dispatchId: "d-more", status: "running" }, { status: 202 });
  if (url.includes("/api/grade")) return signedIn ? Response.json({ success: true }) : Response.json({ success: false, error: "labeler human requires a person" }, { status: 403 });
  if (url.includes("/api/questions")) return Response.json({ resolved: true, success: true, body: { questions: [] } });
  return Response.json({ resolved: true, success: true, body: {} });
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
const { boxContext } = await import("../ui/src/lib/box");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterAll(async () => {
  await teardownDom();
});
beforeEach(() => {
  calls.length = 0;
  available = true;
  signedIn = true;
});

const settle = async () => {
  for (let i = 0; i < 4; i++) await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
};

async function mount(): Promise<HTMLElement> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const outcome = { dispatchId: "d-done", executionId: "e-done", goal: "Where is it raining?", judgeReached: true };
  await act(async () => {
    createRoot(el).render(
      React.createElement(QueryClientProvider, { client: qc }, React.createElement(LiveControlsProvider, null, React.createElement(QuestionsProvider, null, React.createElement(TopBar, { onDispatched: () => {}, openIssues: null, onToggleIssues: () => {}, issuesOpen: false, context: boxContext(null, null, null, null, outcome) })))),
    );
  });
  await settle();
  return el;
}

const setValue = (input: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  const proto = input instanceof window.HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
};

async function typeInBox(el: HTMLElement, text: string): Promise<void> {
  const box = el.querySelector("textarea")!;
  await act(async () => setValue(box, text));
  await act(async () => { box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
  await settle();
}

const button = (el: HTMLElement, text: string) => [...el.querySelectorAll("button")].find((b) => b.textContent === text) as HTMLButtonElement | undefined;

describe("a verdict and a request in one message", () => {
  const sent = (route: string) => calls.filter((c) => c.url.endsWith(route));

  test("must-fail: a reached verdict with a request records the verdict and sends the request as an ask", async () => {
    const el = await mount();
    await typeInBox(el, "That worked, now also list the sources");
    expect(sent("/api/grade").length).toBe(1);
    expect(sent("/api/grade")[0]?.body).toMatchObject({ verdict: "achieved", notes: "That worked" });
    expect(sent("/api/run-goal").length).toBe(1);
    expect(sent("/api/run-goal")[0]?.body).toMatchObject({ goal: "now also list the sources" });
  });

  test("a not-reached verdict with its reason records the reason and sends no ask", async () => {
    const el = await mount();
    await typeInBox(el, "Wrong answer, the dates are off");
    expect(sent("/api/grade")[0]?.body).toMatchObject({ verdict: "not_achieved", notes: "Wrong answer — the dates are off" });
    expect(sent("/api/run-goal").length).toBe(0);
  });
});
