/**
 * Signing in, as a person meets it: a "Sign in" control where it is offered, two
 * fields that post once, and a verdict typed in the box while signed out that is
 * recorded as the person's once they sign in (user ruling 10-24: re-sign-in when
 * needed; a small sign-in form; node-first).
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://surface.test/" });

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { teardownDom, trackRoot } from "./setup.ts";

let available = true;
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
  if (url.endsWith("/api/session")) return Response.json({ available, signedIn, ...(signedIn ? { person } : {}) });
  if (url.endsWith("/api/session/login")) {
    signedIn = true;
    return Response.json({ signedIn: true, person });
  }
  if (url.endsWith("/api/session/logout")) {
    signedIn = false;
    return Response.json({ signedIn: false });
  }
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
  signedIn = false;
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

describe("signing in on the surface", () => {
  test("nothing is shown where sign-in isn't offered", async () => {
    available = false;
    const el = await mount();
    expect(button(el, "Sign in")).toBeUndefined();
    expect(el.querySelector(".sf-signin")).toBeNull();
  });

  test("must-fail: a verdict given signed out is recorded as the person's once they sign in", async () => {
    const el = await mount();
    await typeInBox(el, "wrong answer");
    expect(calls.filter((c) => c.url.includes("/api/grade")).length).toBe(1);
    expect(el.textContent).toContain("not reached · kept on the run; sign in to record it as yours");

    await act(async () => button(el, "Sign in")!.click());
    const form = el.querySelector("form[aria-label='Sign in']") as HTMLFormElement;
    const [email, password] = [form.querySelector("input[type=email]") as HTMLInputElement, form.querySelector("input[type=password]") as HTMLInputElement];
    expect(password.autocomplete).toBe("current-password");
    await act(async () => { setValue(email, "alex@example.test"); setValue(password, "correct horse"); });
    await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await settle();

    expect(calls.find((c) => c.url.endsWith("/api/session/login"))?.body).toEqual({ email: "alex@example.test", password: "correct horse" });
    const grades = calls.filter((c) => c.url.includes("/api/grade"));
    expect(grades.length).toBe(2);
    expect(grades[1]?.body).toMatchObject({ execution_id: "e-done", dispatch_id: "d-done", verdict: "not_achieved", notes: "wrong answer" });
    expect(el.textContent).toContain("Your verdict on that run: not reached · recorded as yours");
    expect(el.querySelector(".sf-signin-who")?.textContent).toMatch(/^Alex · until /);
    expect(el.querySelector("form[aria-label='Sign in']")).toBeNull();
  });

  test("signed in, a verdict in the box is recorded as theirs at once", async () => {
    signedIn = true;
    const el = await mount();
    await typeInBox(el, "that worked");
    expect(calls.filter((c) => c.url.includes("/api/grade")).length).toBe(1);
    expect(el.textContent).toContain("Read as your verdict on this run: reached · recorded as yours");
  });
});
