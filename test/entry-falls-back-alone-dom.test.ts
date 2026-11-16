/**
 * A view chooses each entry's form freely (the USER 11-16: views may rearrange the landing), so an
 * entry can be one its form cannot draw. That entry falls back alone, drawn as plain rows or as its
 * title alone, and the rest of the page stands: the other entries, the box and the sign-in. Before,
 * one entry's throw took the whole page to the router's error screen (node1's landing@12).
 *
 * The whole page is mounted through its router, so this fails on what the page draws.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://surface.test/" });

import { afterAll, describe, expect, test } from "bun:test";
import { teardownDom, trackRoot } from "./setup.ts";

// "words" a form reads as a list, given as a number: no write is accepted with it, but the page
// draws whatever view it is given.
const VIEW = { region: "landing", revision: 4, id: "landing@4", writtenBy: "walk-vessel", notDrawn: null, entries: [
  { pointer: { type: "record_read", shape: "failure" }, form: "rows", title: "Broken", words: 5 },
  { pointer: { type: "record_read", shape: "answer" }, form: "rows", title: "Fine" },
] };
const ROWS = [{ shape: "answer", role: "walk", summary: "Done.", t: "2026-11-16T16:00:00.000Z", seq: 1, id: "a".repeat(64) }];
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = String(input);
  if (url.endsWith("/api/session")) return Response.json({ keySignIn: true, signedIn: false, person: null });
  if (url.includes("/api/ui-view")) return Response.json(VIEW);
  if (url.includes("/api/discovery/resolve")) return Response.json(ROWS);
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

describe("an entry its form cannot draw", () => {
  test("must-fail: it falls back alone, and the other entry, the box and the sign-in stand", async () => {
    const el = document.createElement("div");
    document.body.replaceChildren(el);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const quiet = console.error;
    console.error = () => {};
    try {
      await act(async () => {
        createRoot(el).render(React.createElement(QueryClientProvider, { client: qc }, React.createElement(LiveControlsProvider, null, React.createElement(RouterProvider, { router }))));
      });
      for (let i = 0; i < 8; i++) await act(async () => { await new Promise((r) => setTimeout(r, 40)); });
    } finally {
      console.error = quiet;
    }
    const main = el.querySelector("main")!;
    expect(main.querySelector("[data-view-id]")!.getAttribute("data-view-id")).toBe("landing@4");
    const broken = main.querySelector('section.sf-report[aria-label="Broken"]')!;
    expect(broken.hasAttribute("data-entry-failed")).toBe(true);
    expect(main.querySelector('section.sf-report[aria-label="Fine"]')!.textContent).toContain("Done.");
    expect(el.querySelector("textarea.sf-ask-box")).not.toBeNull();
    expect(el.querySelector(".sf-signin[data-signed-in=false]")).not.toBeNull();
  });
});
