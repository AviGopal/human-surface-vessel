/**
 * Signing in, as a person meets it: a "Sign in" control where it is offered, and one
 * field, the person's own key, that posts once (user ruling 10-24: re-sign-in when
 * needed; a small sign-in form; node-first). A person's rows are written under that key.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://surface.test/" });

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { teardownDom, trackRoot } from "./setup.ts";

let keySignIn = true;
let signedIn = false;
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
  if (url.endsWith("/api/session")) return Response.json({ keySignIn, signedIn, ...(signedIn ? { person } : {}) });
  if (url.endsWith("/api/session/key")) {
    signedIn = true;
    return Response.json({ signedIn: true, person });
  }
  if (url.endsWith("/api/session/logout")) {
    signedIn = false;
    return Response.json({ signedIn: false });
  }
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

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterAll(async () => {
  await teardownDom();
});
beforeEach(() => {
  calls.length = 0;
  keySignIn = true;
  signedIn = false;
});

const settle = async () => {
  for (let i = 0; i < 4; i++) await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
};

async function mount(): Promise<HTMLElement> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    createRoot(el).render(
      React.createElement(QueryClientProvider, { client: qc }, React.createElement(LiveControlsProvider, null, React.createElement(QuestionsProvider, null, React.createElement(TopBar, { openIssues: null, onToggleIssues: () => {}, issuesOpen: false })))),
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

describe("signing in on the surface", () => {
  test("nothing is shown where sign-in isn't offered", async () => {
    keySignIn = false;
    const el = await mount();
    expect(button(el, "Sign in")).toBeUndefined();
    expect(el.querySelector(".sf-signin")).toBeNull();
  });

  test("must-fail: the one field is the person's key; it posts once and says who is signed in", async () => {
    const el = await mount();
    await act(async () => button(el, "Sign in")!.click());
    const form = el.querySelector("form[aria-label='Sign in']") as HTMLFormElement;
    expect(form.querySelector("input[type=email]")).toBeNull();
    const inputs = [...form.querySelectorAll("input")];
    expect(inputs.map((i) => i.getAttribute("aria-label"))).toEqual(["Your key"]);
    await act(async () => { setValue(inputs[0] as HTMLInputElement, "person-key"); });
    await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await settle();
    expect(calls.filter((c) => c.url.endsWith("/api/session/key")).map((c) => c.body)).toEqual([{ key: "person-key" }]);
    expect(el.querySelector(".sf-signin-who")?.textContent).toMatch(/^Alex · until /);
    expect(el.querySelector("form[aria-label='Sign in']")).toBeNull();
  });
});
