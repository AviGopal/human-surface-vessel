/** The run page shows verdicts kept on it beside the judge's, disagreement included. */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://surface.test/" });

import { afterAll, describe, expect, test } from "bun:test";
import { teardownDom, trackRoot } from "./setup.ts";

const REFUSAL = 'labeler "human" requires a credential issued with the "verdict:human" scope';
const VERDICTS: Record<string, unknown[]> = {
  "d-rain": [{ dispatch_id: "d-rain", verdict: "not_achieved", note: "Wrong answer", source: "person", judge_reached: true, observedAt: 1 }],
  "d-refused": [{ dispatch_id: "d-refused", verdict: "not_achieved", note: "", source: "person", judge_reached: false, observedAt: 2, delivery: { recorded: false, status: 403, reason: REFUSAL } }],
  "d-taken": [{ dispatch_id: "d-taken", verdict: "achieved", note: "", source: "person", judge_reached: true, observedAt: 3, delivery: { recorded: true, status: 200, reason: null } }],
};
globalThis.fetch = (async (input: RequestInfo | URL) => {
  if (String(input).includes("/api/verdicts")) {
    const id = new URL(String(input), "http://surface.test").searchParams.get("dispatch_id") ?? "";
    return new Response(JSON.stringify({ body: { verdicts: VERDICTS[id] ?? [] } }), { status: 200 });
  }
  return new Response("{}", { status: 200 });
}) as typeof fetch;

const uiSrc = new URL("../ui/src/", import.meta.url).pathname;
const React = await import(Bun.resolveSync("react", uiSrc));
const { createRoot: rawCreateRoot } = await import(Bun.resolveSync("react-dom/client", uiSrc));
const createRoot = (...a: Parameters<typeof rawCreateRoot>) => trackRoot(rawCreateRoot(...a));
const { act } = React;
const { QueryClient, QueryClientProvider } = await import(Bun.resolveSync("@tanstack/react-query", uiSrc));
const { GradeGesture } = await import("../ui/src/components/GradeGesture");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterAll(async () => {
  await teardownDom();
});

async function shown(dispatchId: string, judgeReached: boolean): Promise<HTMLElement> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    createRoot(el).render(
      React.createElement(QueryClientProvider, { client: qc }, React.createElement(GradeGesture, { renderedState: judgeReached ? "reached" : "not-reached", executionId: "e-1", goal: "Where is it raining?", alreadyGraded: false, humanReachNotes: null, dispatchId, judgeReached })),
    );
  });
  for (let i = 0; i < 3; i++) await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  return el;
}

describe("kept verdicts", () => {
  test("must-fail: a verdict upstream refused reads \"not recorded\" from the kept answer, with upstream's reason on hover", async () => {
    const row = (await shown("d-refused", false)).querySelector(".sf-kept-verdicts li");
    expect(row?.textContent).toBe("You: not reached · not recorded");
    expect(row?.querySelector(".sf-kept-unrecorded")?.getAttribute("title")).toBe(REFUSAL);
  });

  test("a verdict upstream took says nothing more", async () => {
    const row = (await shown("d-taken", true)).querySelector(".sf-kept-verdicts li");
    expect(row?.textContent).toBe("You: reached");
  });

  test("must-fail: a person's verdict that disagrees with the judge is shown, with the judge's", async () => {
    const el = await shown("d-rain", true);
    const row = el.querySelector(".sf-kept-verdicts li");
    expect(row?.getAttribute("data-agree")).toBe("false");
    expect(row?.textContent).toBe("You: not reached · Wrong answer · the judge said reached");
  });
});
