/**
 * A question that arrives after the page first read its questions opens like any other. The
 * questions snapshot used to take a newer read only when the rail's "Updated — show" was
 * pressed; with the rail retired nothing pressed it, and a question that came later opened as
 * "This question is no longer listed." A question opened from a row whose read is newer than the
 * questions held here is read again before it is called gone (qa N2 on 6eed9cc).
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://surface.test/" });

import { afterAll, describe, expect, test } from "bun:test";
import { teardownDom, trackRoot } from "./setup.ts";

const later = {
  id: "q-later", revision: 1, title: "Question", body: "Which repository should the change go to?", createdAt: 0, updatedAt: 0,
  responses: [], answers: [], answered: false, declined: false, kind: "question", readerListed: true,
};
let listed: unknown[] = [];
// While set, a questions read waits on it: the page is looked at with the re-read in flight.
let gate: Promise<void> | null = null;
globalThis.fetch = (async (input: RequestInfo | URL) => {
  if (String(input).includes("/api/questions")) {
    const held = listed;
    if (gate) await gate;
    return Response.json({ resolved: true, success: true, body: { questions: held } });
  }
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
const { QuestionView } = await import("../ui/src/components/QuestionView");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterAll(async () => {
  await teardownDom();
});
const settle = async () => {
  for (let i = 0; i < 5; i++) await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
};

describe("a question that arrives after first paint", () => {
  test("must-fail: it opens with its text, not as no longer listed", async () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const tree = React.createElement(QueryClientProvider, { client: qc }, React.createElement(LiveControlsProvider, null, React.createElement(QuestionsProvider, null, React.createElement(QuestionView, { questionId: "q-later" }))));
    await act(async () => { createRoot(el).render(tree); });
    await settle();
    expect(el.textContent).toContain("no longer listed");
    listed = [later];
    await act(async () => { await qc.invalidateQueries({ queryKey: ["humanQuestions"] }); });
    await settle();
    expect(el.querySelector("article.sf-question")?.textContent).toContain("Which repository should the change go to?");
  });

  test("must-fail: one opened before the questions held here caught up is read again, not called no longer listed", async () => {
    listed = [];
    const el = document.createElement("div");
    document.body.appendChild(el);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = (questionId: string) => React.createElement(QueryClientProvider, { client: qc }, React.createElement(LiveControlsProvider, null, React.createElement(QuestionsProvider, null, React.createElement(QuestionView, { questionId }))));
    const root = createRoot(el);
    await act(async () => { root.render(view("q-elsewhere")); });
    await settle();
    // The row's own read now has it; nothing has re-read the questions held here.
    listed = [later];
    let release!: () => void;
    gate = new Promise((r) => { release = r; });
    await act(async () => { root.render(view("q-later")); });
    await settle();
    // The re-read is in flight: it says so, and does not call the question gone.
    expect(el.textContent).toContain("Loading…");
    expect(el.textContent).not.toContain("no longer listed");
    release();
    gate = null;
    await settle();
    expect(el.querySelector("article.sf-question")?.textContent).toContain("Which repository should the change go to?");
  });
});
