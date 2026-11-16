/**
 * A view chooses an entry's form freely, so the questions form can be given rows that are not
 * questions: node1's landing@12, a walk's, drew a person's world_changed rows (an id, no title) as
 * questions, and the whole page fell to "can't access property "trim", n.title is undefined". Such
 * a row is drawn by its own words, and the page stands.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://surface.test/" });

import { afterAll, describe, expect, test } from "bun:test";
import { teardownDom, trackRoot } from "./setup.ts";

const ROWS = [
  { shape: "world_changed", role: "person", summary: "Put the open problems first.", t: "2026-11-16T16:00:00.000Z", seq: 1, id: "a".repeat(64) },
  { shape: "world_changed", role: "person", t: "2026-11-16T16:01:00.000Z", seq: 2, id: "b".repeat(64) },
];
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.includes("/api/discovery/resolve")) {
    const pointer = JSON.parse(String(init?.body)).pointer as Record<string, unknown>;
    return Response.json(pointer["shape"] === "world_changed" ? ROWS : []);
  }
  if (url.includes("/api/questions")) return Response.json({ resolved: true, success: true, body: { questions: [] } });
  return Response.json({});
}) as typeof fetch;

const uiSrc = new URL("../ui/src/", import.meta.url).pathname;
const React = await import(Bun.resolveSync("react", uiSrc));
const { createRoot: rawCreateRoot } = await import(Bun.resolveSync("react-dom/client", uiSrc));
const createRoot = (...a: Parameters<typeof rawCreateRoot>) => trackRoot(rawCreateRoot(...a));
const { act } = React;
const { QueryClient, QueryClientProvider } = await import(Bun.resolveSync("@tanstack/react-query", uiSrc));
const { LiveControlsProvider } = await import("../ui/src/state/liveControls");
const { QuestionsProvider } = await import("../ui/src/state/questions");
const { Entries } = await import("../ui/src/components/Reports");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterAll(async () => {
  await teardownDom();
});

describe("the questions form over rows that are not questions", () => {
  test("must-fail: rows with no title are drawn by their own words, and the page stands", async () => {
    const el = document.createElement("div");
    document.body.replaceChildren(el);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const entries = [{ pointer: { type: "record_read", shape: "world_changed", where: { role: "person" } }, form: "questions", title: "Asked of me" }];
    await act(async () => {
      createRoot(el).render(React.createElement(QueryClientProvider, { client: qc }, React.createElement(LiveControlsProvider, null, React.createElement(QuestionsProvider, null, React.createElement(Entries, { entries, enabled: true, intervalMs: 60_000, onOpenQuestion: () => {} })))));
    });
    for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    const names = [...el.querySelectorAll(".sf-landing-text")].map((n) => n.textContent);
    expect(names).toContain("Put the open problems first.");
    expect(names.length).toBeGreaterThanOrEqual(1);
  });
});
