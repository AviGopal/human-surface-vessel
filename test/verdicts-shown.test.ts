/** The run page shows verdicts kept on it beside the judge's, disagreement included. */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://surface.test/" });

import { afterAll, describe, expect, test } from "bun:test";

globalThis.fetch = (async (input: RequestInfo | URL) => {
  if (String(input).includes("/api/verdicts")) {
    return new Response(JSON.stringify({ body: { verdicts: [{ dispatch_id: "d-rain", verdict: "not_achieved", note: "Wrong answer", source: "person", judge_reached: true, observedAt: 1 }] } }), { status: 200 });
  }
  return new Response("{}", { status: 200 });
}) as typeof fetch;

const uiSrc = new URL("../ui/src/", import.meta.url).pathname;
const React = await import(Bun.resolveSync("react", uiSrc));
const { createRoot } = await import(Bun.resolveSync("react-dom/client", uiSrc));
const { act } = React;
const { QueryClient, QueryClientProvider } = await import(Bun.resolveSync("@tanstack/react-query", uiSrc));
const { GradeGesture } = await import("../ui/src/components/GradeGesture");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterAll(async () => {
  await GlobalRegistrator.unregister();
});

describe("kept verdicts", () => {
  test("must-fail: a person's verdict that disagrees with the judge is shown, with the judge's", async () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => {
      createRoot(el).render(
        React.createElement(QueryClientProvider, { client: qc }, React.createElement(GradeGesture, { renderedState: "reached", executionId: "e-1", goal: "Where is it raining?", alreadyGraded: false, humanReachNotes: null, dispatchId: "d-rain", judgeReached: true })),
      );
    });
    for (let i = 0; i < 3; i++) await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    const row = el.querySelector(".sf-kept-verdicts li");
    expect(row?.getAttribute("data-agree")).toBe("false");
    expect(row?.textContent).toBe("You: not reached · Wrong answer · the judge said reached");
  });
});
