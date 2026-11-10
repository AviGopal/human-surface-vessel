/**
 * The whole page, mounted through its router: with a view written for the landing,
 * the first screen draws that view's blocks in order. Nothing here imports the
 * landing component, so at a build without views it fails on what the page draws.
 * No run is drawn and no goal-host shape is read: the landing has no such block.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://surface.test/" });

import { afterAll, describe, expect, test } from "bun:test";
import { teardownDom, trackRoot } from "./setup.ts";

const decision = {
  id: "q1", revision: 1, title: "Question", body: "Gap reach-gap-docs-align-tick (unreachable_producer) has failed auto-repair 8+ times. Summary: docs align",
  createdAt: 0, updatedAt: 0, responses: [], answers: [], answered: false, declined: false, kind: "gap_needs_human",
};
const goalHostReads: string[] = [];
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.includes("/api/ui-view")) return Response.json({ region: "landing", revision: 4, id: "landing@4", blocks: ["reports", "needs_you"], limits: {}, reports: [{ type: "system_load_report" }] });
  if (url.includes("/api/discovery/resolve")) return Response.json({ success: true, shape: "systemLoadReport", body: { load_avg_1m: 2.61, cpu_cores: 16 } });
  if (url.includes("/api/questions")) return Response.json({ resolved: true, success: true, body: { questions: [decision] } });
  if (url.includes("/api/resolve")) goalHostReads.push(JSON.parse(String(init?.body ?? "{}")).type);
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

describe("the first screen follows the landing's view", () => {
  test("must-fail: the view's blocks are drawn in its order, not the newest run", async () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => {
      createRoot(el).render(React.createElement(QueryClientProvider, { client: qc }, React.createElement(LiveControlsProvider, null, React.createElement(RouterProvider, { router }))));
    });
    for (let i = 0; i < 8; i++) await act(async () => { await new Promise((r) => setTimeout(r, 40)); });
    const main = el.querySelector("main")!;
    const blocks = [...main.querySelectorAll("[data-block]")].map((b) => b.getAttribute("data-block"));
    expect(blocks).toEqual(["reports", "needs_you"]);
    expect(main.textContent).toContain("Reach gap docs align tick");
    expect(main.querySelector("[data-report=system_load_report]")?.textContent).toContain("2.61");
    expect(main.querySelector(".sf-run")).toBeNull();
    expect(goalHostReads.filter((t) => /^goalWalk/.test(t))).toEqual([]);
  });
});
