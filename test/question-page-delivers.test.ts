/**
 * A run's question has one path wherever it is opened. Before this, the question
 * page recorded an answer on the question only, and the waiting run never got it.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://surface.test/" });

import { afterAll, describe, expect, test } from "bun:test";

const calls: { url: string; body: Record<string, unknown> }[] = [];
const question = {
  id: "solicitation-s-9", revision: 1, title: "Where should it look?", body: "## Where should it look?", createdAt: 1, updatedAt: 1,
  responses: [], answered: false, declined: false, run: { dispatchId: "d-wait", solicitationId: "s-9", deadlineAt: null, linked: true },
};
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
  } catch {
    /* not json */
  }
  calls.push({ url, body });
  if (url.includes("/api/questions")) return new Response(JSON.stringify({ resolved: true, success: true, body: { questions: [question] } }), { status: 200 });
  if (url.includes("/api/participation")) return new Response(JSON.stringify({ resolved: true, success: true, body: { id: body["response_id"], panelId: body["panel_id"], panelRevision: body["panel_revision"] } }), { status: 200 });
  if (body["type"] === "goalWalkState") return new Response(JSON.stringify({ resolved: true, shape: "goalWalkState", body: { dispatchId: "d-wait", status: "running", reached: null, walkLog: [], poolProvenance: [], pendingTargets: [], poolShapes: [], poolEvents: [], steps: [] } }), { status: 200 });
  return new Response(JSON.stringify({ resolved: true, success: true, body: {} }), { status: 200 });
}) as typeof fetch;

const uiSrc = new URL("../ui/src/", import.meta.url).pathname;
const React = await import(Bun.resolveSync("react", uiSrc));
const { createRoot } = await import(Bun.resolveSync("react-dom/client", uiSrc));
const { act } = React;
const { QueryClient, QueryClientProvider } = await import(Bun.resolveSync("@tanstack/react-query", uiSrc));
const { LiveControlsProvider } = await import("../ui/src/state/liveControls");
const { QuestionsProvider } = await import("../ui/src/state/questions");
const { QuestionView } = await import("../ui/src/components/QuestionView");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterAll(async () => {
  await GlobalRegistrator.unregister();
});

describe("a run's question on the questions page", () => {
  test("must-fail: answering it there reaches the waiting run, as on the run page", async () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => {
      createRoot(el).render(React.createElement(QueryClientProvider, { client: qc }, React.createElement(LiveControlsProvider, null, React.createElement(QuestionsProvider, null, React.createElement(QuestionView, { questionId: "solicitation-s-9" })))));
    });
    for (let i = 0; i < 5; i++) await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    const box = el.querySelector("textarea[aria-label='Answer']") as HTMLTextAreaElement;
    expect(box).not.toBeNull();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!;
      setter.call(box, "Bergen");
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      (el.querySelector("form.sf-run-question-form") as HTMLFormElement).requestSubmit();
    });
    for (let i = 0; i < 3; i++) await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    const delivered = calls.find((c) => c.body["type"] === "solicitationResponse_write");
    expect(delivered?.body).toMatchObject({ solicitationId: "s-9", outcome: "answered" });
  });
});
