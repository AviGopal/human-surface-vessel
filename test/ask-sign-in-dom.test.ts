/**
 * Asking needs a signed-in person (user ruling 10-27: "Require sign-in to ask"). An ask
 * typed signed out is not sent: sign-in opens with the ask still in the box, and once
 * signed in the ask goes. A phrase that only changes the view still works signed out.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://surface.test/" });

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { teardownDom, trackRoot } from "./setup.ts";

let available = true;
const dispatched: string[] = [];
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
  const person = { userId: "user:person-a", name: "Person A", email: "person-a@example.test", expiresAt: Date.now() + 900_000 };
  if (url.endsWith("/api/session")) return Response.json({ available, signedIn, ...(signedIn ? { person } : {}) });
  if (url.endsWith("/api/session/login")) {
    signedIn = true;
    return Response.json({ signedIn: true, person });
  }
  if (url.endsWith("/api/session/logout")) {
    signedIn = false;
    return Response.json({ signedIn: false });
  }
  if (url.endsWith("/api/surface-intent")) {
    return String(body["instruction"]) === "show this as a table" ? Response.json({ view: { form: "rows" } }) : new Response("{}", { status: 422 });
  }
  if (url.endsWith("/api/run-goal")) return signedIn ? Response.json({ dispatchId: "d-asked", status: "running" }, { status: 202 }) : Response.json({ error: "sign_in_required" }, { status: 401 });
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
  dispatched.length = 0;
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
  const outcome = null;
  await act(async () => {
    createRoot(el).render(
      React.createElement(QueryClientProvider, { client: qc }, React.createElement(LiveControlsProvider, null, React.createElement(QuestionsProvider, null, React.createElement(TopBar, { onDispatched: (id: string) => dispatched.push(id), openIssues: null, onToggleIssues: () => {}, issuesOpen: false, context: boxContext(null, null, null, null, outcome) })))),
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

describe("asking needs a signed-in person", () => {
  const asks = () => calls.filter((c) => c.url.endsWith("/api/run-goal"));

  test("must-fail: an ask typed signed out dispatches nothing and opens sign-in, the ask still in the box", async () => {
    const el = await mount();
    await typeInBox(el, "What time is it in Lisbon?");
    expect(asks().length).toBe(1);
    expect(dispatched).toEqual([]);
    expect(el.querySelector("form[aria-label='Sign in']")).not.toBeNull();
    expect((el.querySelector("textarea") as HTMLTextAreaElement).value).toBe("What time is it in Lisbon?");
  });

  test("must-fail: once signed in, the ask that was held is sent", async () => {
    const el = await mount();
    await typeInBox(el, "What time is it in Lisbon?");
    const form = el.querySelector("form[aria-label='Sign in']") as HTMLFormElement;
    const [email, password] = [form.querySelector("input[type=email]") as HTMLInputElement, form.querySelector("input[type=password]") as HTMLInputElement];
    await act(async () => { setValue(email, "person-a@example.test"); setValue(password, "correct horse"); });
    await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await settle();
    expect(asks().length).toBe(2);
    expect(asks()[1]?.body).toMatchObject({ goal: "What time is it in Lisbon?" });
    expect(dispatched).toEqual(["d-asked"]);
  });

  test("a phrase that only changes the view works signed out and asks nothing", async () => {
    const el = await mount();
    await typeInBox(el, "show this as a table");
    expect(asks().length).toBe(0);
    expect(el.querySelector("form[aria-label='Sign in']")).toBeNull();
  });
});
