/**
 * A view arranges the landing freely, a walk's as much as a person's: the USER 11-16, "It should
 * be able to change around the page freely, though we should keep some components such as the
 * text entry and sign in visible." The box a person asks through and their sign-in are the page's
 * own, drawn above every view, so no view can leave a person unable to ask or sign in: not one
 * that lists nothing of the defaults, and not a view that could not be read.
 *
 * The whole page is mounted through its router, so this fails on what the page draws.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://surface.test/" });

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { teardownDom, trackRoot } from "./setup.ts";

// A view a walk wrote: one entry, none of the defaults, no questions.
const WALKS = { region: "landing", revision: 3, id: "landing@3", writtenBy: "walk-vessel", notDrawn: null, entries: [
  { pointer: { type: "record_read", shape: "world_changed" }, form: "rows", show: 1, title: "Latest ask" },
] };
let view: "walk" | "unreadable" = "walk";
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = String(input);
  if (url.endsWith("/api/session")) return Response.json({ keySignIn: true, signedIn: false, person: null });
  if (url.includes("/api/ui-view")) return view === "walk" ? Response.json(WALKS) : Response.json({ error: "unavailable" }, { status: 503 });
  if (url.includes("/api/discovery/resolve")) return Response.json([]);
  if (url.includes("/api/questions")) return Response.json({ resolved: true, success: true, body: { questions: [] } });
  return Response.json({});
}) as typeof fetch;

const uiSrc = new URL("../ui/src/", import.meta.url).pathname;
const React = await import(Bun.resolveSync("react", uiSrc));
const { createRoot: rawCreateRoot } = await import(Bun.resolveSync("react-dom/client", uiSrc));
const createRoot = (...a: Parameters<typeof rawCreateRoot>) => trackRoot(rawCreateRoot(...a));
const { act } = React;
const { QueryClient, QueryClientProvider } = await import(Bun.resolveSync("@tanstack/react-query", uiSrc));
const { RouterProvider } = await import(Bun.resolveSync("@tanstack/react-router", uiSrc));
const { LiveControlsProvider } = await import("../ui/src/state/liveControls");
const { router } = await import("../ui/src/router");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterAll(async () => {
  await teardownDom();
});
beforeEach(() => {
  document.body.replaceChildren();
});

async function mount(): Promise<HTMLElement> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    createRoot(el).render(React.createElement(QueryClientProvider, { client: qc }, React.createElement(LiveControlsProvider, null, React.createElement(RouterProvider, { router }))));
  });
  for (let i = 0; i < 8; i++) await act(async () => { await new Promise((r) => setTimeout(r, 40)); });
  return el;
}

/** The box and the sign-in, each outside what the view draws. */
function ownControls(el: HTMLElement): { box: boolean; signIn: boolean } {
  const main = el.querySelector("main")!;
  const box = el.querySelector("textarea.sf-ask-box");
  const signIn = el.querySelector(".sf-signin[data-signed-in=false]");
  return { box: box !== null && !main.contains(box), signIn: signIn !== null && !main.contains(signIn) };
}

describe("a view arranges the landing; the box and sign-in are the page's own", () => {
  test("must-fail: under a walk's view listing none of the defaults, the box and sign-in are drawn", async () => {
    view = "walk";
    const el = await mount();
    expect(el.querySelector("main [data-view-id]")!.getAttribute("data-view-id")).toBe("landing@3");
    expect(ownControls(el)).toEqual({ box: true, signIn: true });
  });

  test("must-fail: with the view unreadable, the box and sign-in are drawn", async () => {
    view = "unreadable";
    const el = await mount();
    expect(el.querySelector("main")!.textContent).toContain("The view could not be read");
    expect(ownControls(el)).toEqual({ box: true, signIn: true });
  });
});
