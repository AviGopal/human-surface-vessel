/**
 * The grade box speaks to what the run did. A reached answer is offered answer
 * wording; only a run that made a change is offered change wording. Shape: the
 * 10-14 news summary and arithmetic runs were offered "Right idea, wrong change".
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://surface.test/" });

import { afterAll, describe, expect, test } from "bun:test";
import { teardownDom, trackRoot } from "./setup.ts";

globalThis.fetch = (async () => new Response("{}", { status: 200 })) as typeof fetch;
const uiSrc = new URL("../ui/src/", import.meta.url).pathname;
const from = (spec: string): string => Bun.resolveSync(spec, uiSrc);
const React = await import(from("react"));
const { createRoot: rawCreateRoot } = await import(from("react-dom/client"));
const createRoot = (...a: Parameters<typeof rawCreateRoot>) => trackRoot(rawCreateRoot(...a));
const { act } = React;
const { QueryClient, QueryClientProvider } = await import(from("@tanstack/react-query"));
const { GradeGesture } = await import("../ui/src/components/GradeGesture");
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function options(props: Record<string, unknown>): Promise<string[]> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  await act(async () => {
    createRoot(el).render(React.createElement(QueryClientProvider, { client: new QueryClient() },
      React.createElement(GradeGesture, { executionId: "e", goal: "g", alreadyGraded: false, humanReachNotes: null, ...props })));
  });
  return [...el.querySelectorAll("label, button")].map((x) => x.textContent?.trim() ?? "").filter(Boolean);
}

afterAll(async () => {
  await teardownDom();
});

describe("grade options", () => {
  test("must-fail: a reached answer is not offered change wording", async () => {
    const got = await options({ renderedState: "reached" });
    expect(got).toContain("Wrong answer");
    expect(got).not.toContain("Right idea, wrong change");
  });

  test("a reached code edit keeps the change wording", async () => {
    const got = await options({ renderedState: "reached", changedSomething: true });
    expect(got).toContain("Right idea, wrong change");
  });
});
