/**
 * At phone width the rail is one line until the person opens it; what waits on the person is
 * listed once, in the main pane, and the line carries only its count. Its folded groups (notices, questions naming no reader, malformed) are bookkeeping a
 * person cannot act on, and the band they filled was a third of the screen before any content.
 * At desk width the rail is drawn open, as before.
 *
 * Shapes: one node 11-11. The phone page pinned the top bar and a 162px rail of three folded
 * counts above "Waiting on you".
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://surface.test/", width: 420, height: 900 });

import { afterAll, describe, expect, test } from "bun:test";
import { teardownDom, trackRoot } from "./setup.ts";

const notice = { id: "n1", revision: 1, title: "Run finished", body: "Nothing to decide.", kind: "notice", createdAt: 0, updatedAt: 0, responses: [], answered: false, declined: false, rank: 1 };
let waiting = false;
const ask = { ...notice, id: "a1", kind: "ask", title: "Which way?", body: "Pick one.", reader: "listed_reader", readerListed: true };
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.includes("/api/ui-view")) return Response.json({ region: "landing", revision: 0, id: "landing@0", notDrawn: null, entries: [{ pointer: { type: "uiQuestion", open: true }, form: "questions", field: "questions", title: "Waiting on you" }] });
  const questions = waiting ? [ask, notice] : [notice];
  const classes = { ask: waiting ? 1 : 0, notice: 1, settled: 0, unread: 0, malformed: 0 };
  if (url.includes("/api/questions")) return Response.json({ resolved: true, success: true, body: { questions, classes } });
  if (url.includes("/api/discovery/resolve")) {
    const pointer = JSON.parse(String(init?.body)).pointer as { type: string };
    if (pointer.type === "uiQuestion") return Response.json({ success: true, body: { questions: waiting ? [ask] : [], classes } });
    return Response.json([]);
  }
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
const settle = async () => {
  for (let i = 0; i < 8; i++) await act(async () => { await new Promise((r) => setTimeout(r, 40)); });
};
async function page(width: number): Promise<HTMLElement> {
  (window as unknown as { happyDOM: { setViewport: (v: { width: number; height: number }) => void } }).happyDOM.setViewport({ width, height: 900 });
  const el = document.createElement("div");
  document.body.appendChild(el);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    createRoot(el).render(React.createElement(QueryClientProvider, { client: qc }, React.createElement(LiveControlsProvider, null, React.createElement(RouterProvider, { router }))));
  });
  await settle();
  return el;
}
const list = (el: HTMLElement): HTMLElement => el.querySelector("#sf-rail-list")!;
const toggle = (el: HTMLElement): HTMLButtonElement | null => el.querySelector(".sf-rail-toggle");

describe("the rail at phone width", () => {
  test("must-fail: with nothing waiting, the rail is one line, closed, and opens on a tap", async () => {
    waiting = false;
    const el = await page(420);
    expect(toggle(el)).not.toBeNull();
    expect(toggle(el)!.getAttribute("aria-expanded")).toBe("false");
    expect(list(el).hidden).toBe(true);
    await act(async () => toggle(el)!.click());
    expect(list(el).hidden).toBe(false);
    expect(toggle(el)!.getAttribute("aria-expanded")).toBe("true");
  });

  test("must-fail: when something waits on the person, the rail stays one line carrying the count; the main pane lists it once", async () => {
    waiting = true;
    const el = await page(420);
    expect(list(el).hidden).toBe(true);
    expect(toggle(el)!.querySelector("[data-attention]")!.textContent).toBe("1");
    expect(el.querySelector("main")!.textContent).toContain("Pick one.");
    const visible = [...el.querySelectorAll("*")].filter((n) => n.children.length === 0 && n.textContent === "Pick one." && !n.closest("[hidden]"));
    expect(visible.length).toBe(1);
  });

  test("at desk width the rail is drawn open, with no toggle", async () => {
    waiting = false;
    const el = await page(1440);
    expect(toggle(el)).toBeNull();
    expect(list(el).hidden).toBe(false);
  });
});
