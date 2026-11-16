/**
 * One question open is one card, wherever its row is. A question among a waiting entry's earlier
 * rows opens above the list; expanding "earlier" draws its row, not a second card with a second
 * draft (qa N1 on 6eed9cc).
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://surface.test/" });

import { afterAll, describe, expect, test } from "bun:test";
import { teardownDom, trackRoot } from "./setup.ts";

const q = (id: string, body: string) => ({ id, revision: 1, title: "Question", body, createdAt: 0, updatedAt: 0, responses: [], answers: [], answered: false, declined: false, kind: "question", readerListed: true });
const QS = [q("q-old", "Which branch should the release be cut from?"), q("q-new", "May the docs loop pause over the weekend?")];
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.includes("/api/questions")) return Response.json({ resolved: true, success: true, body: { questions: QS } });
  if (url.includes("/api/discovery/resolve") && JSON.parse(String(init?.body)).pointer?.type === "uiQuestion") return Response.json({ resolved: true, success: true, body: { questions: QS } });
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
const settle = async () => {
  for (let i = 0; i < 5; i++) await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
};
const WAITING = { pointer: { type: "uiQuestion", open: true }, form: "questions", field: "questions", title: "Waiting on you", show: 1 };

describe("a question among the earlier rows", () => {
  test("must-fail: it opens above the list, and expanding earlier draws no second card", async () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const root = createRoot(el);
    const page = (openQuestion: string | null) => React.createElement(QueryClientProvider, { client: qc }, React.createElement(LiveControlsProvider, null, React.createElement(QuestionsProvider, null,
      React.createElement(Entries, { entries: [WAITING], enabled: true, intervalMs: 60_000, onOpenQuestion: () => {}, openQuestion }))));
    await act(async () => { root.render(page(null)); });
    await settle();
    // Which row the entry holds back as earlier is the entry's; open that one.
    const shown = el.querySelector("button.sf-landing-row")!.getAttribute("data-solicitation-id")!;
    const earlier = QS.map((x) => x.id).find((id) => id !== shown)!;
    await act(async () => { root.render(page(earlier)); });
    await settle();
    expect(el.querySelectorAll(`[data-question-open="${earlier}"]`)).toHaveLength(1);
    const more = el.querySelector("details.sf-earlier") as HTMLDetailsElement;
    expect(more).not.toBeNull();
    await act(async () => { more.open = true; more.dispatchEvent(new Event("toggle")); });
    await settle();
    expect(el.querySelector(`details.sf-earlier button[data-solicitation-id="${earlier}"]`)).not.toBeNull();
    expect(el.querySelectorAll(`[data-question-open="${earlier}"]`)).toHaveLength(1);
    expect(el.querySelectorAll("article.sf-question")).toHaveLength(1);
  });
});
