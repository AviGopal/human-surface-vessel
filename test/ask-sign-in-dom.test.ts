/**
 * Asking needs a signed-in person (user ruling 10-27: "Require sign-in to ask"). An ask is
 * one world_changed row written under the person's own key; signed out the surface refuses
 * the write, sign-in opens with the ask still in the box, and once signed in the ask goes.
 * A phrase that only changes the view still works signed out.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://surface.test/" });

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { teardownDom, trackRoot } from "./setup.ts";

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
  if (url.endsWith("/api/session")) return Response.json({ keySignIn: true, signedIn, ...(signedIn ? { person } : {}) });
  if (url.endsWith("/api/session/key")) {
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
  // The ask region before any view is written: nothing follows the ask. A stored ask now mounts it.
  if (url.includes("/api/ui-view")) return Response.json({ region: "ask", revision: 0, id: "ask@0", notDrawn: null, entries: [] });
  if (url.endsWith("/api/discovery/resolve")) return signedIn ? Response.json({ ok: true, seq: 301, id: "row-301" }) : Response.json({ error: "sign_in_required", reason: "a write is sent only under the signed-in person's own key" }, { status: 401 });
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

describe("asking needs a signed-in person", () => {
  // Sends only: once an ask is stored, what follows it reads through the same route.
  const asks = () => calls.filter((c) => c.url.endsWith("/api/discovery/resolve") && (c.body["pointer"] as { type?: string } | undefined)?.type !== "record_read");

  test("must-fail: an ask typed signed out is not recorded and opens sign-in, the ask still in the box", async () => {
    const el = await mount();
    await typeInBox(el, "What time is it in Lisbon?");
    expect(asks().length).toBe(1);
    expect(el.textContent).toContain("Not sent yet: sign in with your key, and your ask goes then.");
    expect(el.querySelector("form[aria-label='Sign in']")).not.toBeNull();
    expect((el.querySelector("textarea") as HTMLTextAreaElement).value).toBe("What time is it in Lisbon?");
  });

  test("must-fail: once signed in, the ask that was held is sent", async () => {
    const el = await mount();
    await typeInBox(el, "What time is it in Lisbon?");
    const form = el.querySelector("form[aria-label='Sign in']") as HTMLFormElement;
    const key = form.querySelector("input[name=key]") as HTMLInputElement;
    await act(async () => setValue(key, "person-key-abc123"));
    await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await settle();
    expect(asks().length).toBe(2);
    expect(asks()[1]?.body).toEqual({ pointer: { type: "record_write", row: { shape: "world_changed", what: "What time is it in Lisbon?", input_refs: [] } } });
    expect(el.textContent).toContain("Asked (record #301).");
    expect((el.querySelector("textarea") as HTMLTextAreaElement).value).toBe("");
  });

  test("a phrase that only changes the view works signed out and asks nothing", async () => {
    const el = await mount();
    await typeInBox(el, "show this as a table");
    expect(asks().length).toBe(0);
    expect(el.querySelector("form[aria-label='Sign in']")).toBeNull();
  });
});
