/**
 * Where a person's own key is accepted, sign-in is one field: the key. It is posted once to the
 * surface's own route and cleared from the field; the page keeps nothing of it.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://surface.test/" });

import { afterAll, describe, expect, test } from "bun:test";
import { teardownDom, trackRoot } from "./setup.ts";

let signedIn = false;
const posts: { url: string; body: Record<string, unknown> }[] = [];
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (init?.method === "POST") posts.push({ url, body: JSON.parse(String(init.body ?? "{}")) as Record<string, unknown> });
  const person = { userId: "key_person_1", name: null, email: null, expiresAt: Date.now() + 900_000 };
  if (url.endsWith("/api/session")) return Response.json({ available: false, keySignIn: true, signedIn, ...(signedIn ? { person } : {}) });
  if (url.endsWith("/api/session/key")) {
    signedIn = true;
    return Response.json({ signedIn: true, person });
  }
  return Response.json({});
}) as typeof fetch;

const uiSrc = new URL("../ui/src/", import.meta.url).pathname;
const React = await import(Bun.resolveSync("react", uiSrc));
const { createRoot: rawCreateRoot } = await import(Bun.resolveSync("react-dom/client", uiSrc));
const createRoot = (...a: Parameters<typeof rawCreateRoot>) => trackRoot(rawCreateRoot(...a));
const { act } = React;
const { QueryClient, QueryClientProvider } = await import(Bun.resolveSync("@tanstack/react-query", uiSrc));
const { SignIn } = await import("../ui/src/components/SignIn");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterAll(async () => {
  await teardownDom();
});
const settle = async () => {
  for (let i = 0; i < 4; i++) await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
};
const setValue = (input: HTMLInputElement, value: string) => {
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
};

describe("signing in with a key", () => {
  test("must-fail: one key field, posted once to the surface, then cleared and signed in", async () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => {
      createRoot(el).render(React.createElement(QueryClientProvider, { client: qc }, React.createElement(SignIn, {})));
    });
    await settle();
    const open = [...el.querySelectorAll("button")].find((b) => b.textContent === "Sign in")!;
    await act(async () => open.click());
    expect(el.querySelector('input[name="email"]')).toBeNull();
    const field = el.querySelector('input[name="key"]') as HTMLInputElement;
    expect(field.type).toBe("password");
    await act(async () => setValue(field, "person-key-abc123"));
    await act(async () => (el.querySelector("form") as HTMLFormElement).requestSubmit());
    await settle();
    expect(posts).toEqual([{ url: "/api/session/key", body: { key: "person-key-abc123" } }]);
    expect(el.querySelector('[data-signed-in="true"]')?.textContent).toContain("key_person_1");
  });
});
