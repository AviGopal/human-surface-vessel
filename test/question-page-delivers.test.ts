/**
 * A run's question has one path wherever it is opened: the one box (16f-2). Before
 * that, the run page and the questions page each drew their own form for it.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://surface.test/" });

import { afterAll, describe, expect, test } from "bun:test";
import { teardownDom, trackRoot } from "./setup.ts";

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

describe("a run's question on the questions page", () => {
  test("must-fail (G1): it is drawn without a second input; the one box answers it (16f-2)", async () => {
    // The box's reply context there is waitingQuestion(…, questionId) (run-state-facts.test.ts);
    // the answer path itself is the box's (one-box.test.ts).
    const el = document.createElement("div");
    document.body.appendChild(el);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => {
      createRoot(el).render(React.createElement(QueryClientProvider, { client: qc }, React.createElement(LiveControlsProvider, null, React.createElement(QuestionsProvider, null, React.createElement(QuestionView, { questionId: "solicitation-s-9" })))));
    });
    for (let i = 0; i < 5; i++) await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    const section = el.querySelector("[aria-label='Question']");
    expect(section).not.toBeNull();
    expect(section?.textContent).toContain("Where should it look?");
    expect(el.querySelector("form.sf-run-question-form, textarea[aria-label='Answer']")).toBeNull();
    const buttons = [...el.querySelectorAll("[aria-label='Question'] button")].map((b) => b.textContent);
    expect(buttons).not.toContain("Need more");
    expect(buttons).not.toContain("Decline");
    expect(buttons).not.toContain("Send");
    // The run is still kept waiting while its question is on screen.
    expect(calls.some((c) => c.body["type"] === "solicitationHeartbeat_write")).toBe(true);
  });
});
