/**
 * A report goes through the surface only under the signed-in person's own key (src/routes/proxy.ts):
 * signed out, every report is refused. Signing in reads the reports again at once, so they fill
 * without a reload; signing out drops what was read under the person's key at once, so none of it
 * stays on screen for whoever comes to the page next.
 *
 * Shape: one node 11-12. A person signed in and the landing stayed on its refusals until they
 * reloaded: the reports were re-read only on their next cycle, a minute on.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://surface.test/" });

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { teardownDom, trackRoot } from "./setup.ts";
import { DEFAULT_VIEWS } from "../src/ui-views.ts";

const ASK = { input_refs: [], shape: "world_changed", what: "What is happening?", seq: 10, t: "2026-11-12T09:00:00.000Z", writer: "a person", role: "person", id: "ask-row-one" };
const PERSON = { userId: "key_person_1", name: null, email: null, expiresAt: Date.now() + 900_000 };

let signedIn = false;
let reads = 0;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.endsWith("/api/session")) return Response.json({ keySignIn: true, signedIn, ...(signedIn ? { person: PERSON } : {}) });
  if (url.endsWith("/api/session/key")) {
    signedIn = true;
    return Response.json({ signedIn: true, person: PERSON });
  }
  if (url.endsWith("/api/session/logout")) {
    signedIn = false;
    return Response.json({ signedIn: false });
  }
  if (url.includes("/api/discovery/resolve")) {
    reads++;
    // The live refusal, as proxy.ts sends it signed out.
    if (!signedIn) return Response.json({ error: "sign_in_required", reason: "a lookup is sent only under the caller's own key: sign in" }, { status: 401 });
    const pointer = JSON.parse(String(init?.body)).pointer as Record<string, unknown>;
    return Response.json(pointer["shape"] === ASK.shape && pointer["where"] === undefined ? [ASK] : []);
  }
  return Response.json({});
}) as typeof fetch;

const uiSrc = new URL("../ui/src/", import.meta.url).pathname;
const React = await import(Bun.resolveSync("react", uiSrc));
const { createRoot: rawCreateRoot } = await import(Bun.resolveSync("react-dom/client", uiSrc));
const createRoot = (...a: Parameters<typeof rawCreateRoot>) => trackRoot(rawCreateRoot(...a));
const { act } = React;
const { QueryClient, QueryClientProvider } = await import(Bun.resolveSync("@tanstack/react-query", uiSrc));
const { Entries } = await import("../ui/src/components/Reports");
const { SignIn } = await import("../ui/src/components/SignIn");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterAll(async () => {
  await teardownDom();
});
beforeEach(() => {
  document.body.replaceChildren();
  reads = 0;
});
const settle = async () => {
  for (let i = 0; i < 4; i++) await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
};
const setValue = (input: HTMLInputElement, value: string) => {
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
};
const asks = DEFAULT_VIEWS.landing.entries.find((e) => e.title === "What people asked")!;

async function mount(): Promise<HTMLElement> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // The page's live cadence: a minute, longer than the test, so only the sign-in or sign-out can re-read.
  const page = React.createElement(React.Fragment, null, React.createElement(SignIn, {}), React.createElement(Entries, { entries: [asks] as never, enabled: true, intervalMs: 60_000, onOpenQuestion: () => {} }));
  await act(async () => {
    createRoot(el).render(React.createElement(QueryClientProvider, { client: qc }, page));
  });
  await settle();
  return el;
}
const rows = (el: HTMLElement) => el.querySelectorAll(`.sf-row[data-row="${ASK.id}"]`).length;
const button = (el: HTMLElement, text: string) => [...el.querySelectorAll("button")].find((b) => b.textContent === text) as HTMLButtonElement;

describe("signing in or out reads the reports again at once", () => {
  test("must-fail: refused signed out, the reports fill as soon as the person signs in, with no reload", async () => {
    signedIn = false;
    const el = await mount();
    expect(rows(el)).toBe(0);
    const before = reads;
    expect(before).toBeGreaterThan(0);
    await act(async () => button(el, "Sign in").click());
    await act(async () => setValue(el.querySelector('input[name="key"]') as HTMLInputElement, "person-key-abc123"));
    await act(async () => (el.querySelector("form") as HTMLFormElement).requestSubmit());
    await settle();
    expect(reads).toBeGreaterThan(before);
    expect(rows(el)).toBe(1);
  });

  test("must-fail: signing out drops what was read under the person's key at once", async () => {
    signedIn = true;
    const el = await mount();
    expect(rows(el)).toBe(1);
    await act(async () => button(el, "Sign out").click());
    await settle();
    expect(rows(el)).toBe(0);
  });
});
