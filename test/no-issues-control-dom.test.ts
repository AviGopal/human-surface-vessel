/**
 * The page has no Issues control and never reads /api/gaps. That list read the interface's own
 * gaps (substrateGap, category ui_legibility) from the gap store, and no vessel serves that shape
 * any more: the button showed no count and opened onto "Issue list unavailable" on every page.
 * Gap rows now live in records, and they reach a person through what the page draws, not
 * through a list of the surface's own.
 *
 * GUARD: one gap by id (/api/gaps/:id) stays, for a question card; gap-routes-name-no-key pins
 * that it still answers.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://surface.test/" });

import { afterAll, describe, expect, test } from "bun:test";
import { teardownDom, trackRoot } from "./setup.ts";

const urls: string[] = [];
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = String(input);
  urls.push(url);
  if (url.endsWith("/api/session")) return Response.json({ keySignIn: true, signedIn: false });
  if (url.includes("/api/ui-view")) return Response.json({ region: "landing", revision: 0, id: "landing@0", notDrawn: null, entries: [] });
  if (url.includes("/api/questions")) return Response.json({ resolved: true, success: true, body: { questions: [] } });
  if (url.endsWith("/api/gaps")) return Response.json({ gaps: [{ id: "g-one", status: "open", source: "human_reported", category: "ui_legibility", summary: "a gap" }] });
  return Response.json({ resolved: true, success: true, body: {} });
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

describe("the page without the Issues list", () => {
  test("must-fail: the whole page draws with no Issues control and sends no request to /api/gaps", async () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => {
      createRoot(el).render(
        React.createElement(QueryClientProvider, { client: qc }, React.createElement(LiveControlsProvider, null, React.createElement(RouterProvider, { router }))),
      );
    });
    for (let i = 0; i < 5; i++) await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    // control: the page drew (its box), so an absence below is the page's, not a blank mount
    expect(el.querySelector("textarea")).not.toBeNull();
    expect([...el.querySelectorAll("button")].map((b) => (b.textContent ?? "").trim()).filter((t) => t.startsWith("Issues"))).toEqual([]);
    expect(el.querySelector("[aria-controls='sf-issues'], #sf-issues, .sf-issues")).toBeNull();
    expect(urls.filter((u) => /\/api\/gaps(\?|$)/.test(u))).toEqual([]);
  });
});
