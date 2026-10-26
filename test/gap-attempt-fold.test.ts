/**
 * A gap thread under System: repeated refusals with no run to open read as one
 * line with a count, and no gap opens itself when nothing is on screen.
 *
 * Shape: one node 10-26, the trace-store gap with 873 attempts, every one
 * "gap_to_feature · refused · no run recorded", and all of them drawn open.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://surface.test/" });

import { afterAll, describe, expect, test } from "bun:test";
import { teardownDom, trackRoot } from "./setup.ts";

const uiSrc = new URL("../ui/src/", import.meta.url).pathname;
const React = await import(Bun.resolveSync("react", uiSrc));
const { createRoot: rawCreateRoot } = await import(Bun.resolveSync("react-dom/client", uiSrc));
const createRoot = (...a: Parameters<typeof rawCreateRoot>) => trackRoot(rawCreateRoot(...a));
const { act } = React;
const { GapThreads, foldAttempts } = await import("../ui/src/components/GapThreads");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterAll(async () => {
  await teardownDom();
});

const at = (h: number, m: number): string => new Date(Date.UTC(2026, 9, 26, h, m)).toISOString();
const refused = (id: string, h: number, m: number) => ({ attemptId: id, at: at(h, m), route: "gap_to_feature", stage: null, dispatchId: null, outcome: "refused", verdict: null, landed: false, commit: null });
const attempts = [
  refused("a5", 7, 21), refused("a4", 7, 9), refused("a3", 7, 0),
  { ...refused("a2", 6, 50), dispatchId: "d-run" },
  refused("a1", 6, 40),
];
const thread = { gapId: "trace-store-reconcile-2026-09-30T16", summary: "Trace store over its cap", status: "open", reopenCount: 0, attemptCount: 873, landedCount: 0, lastAt: at(7, 21), attempts };

async function mount(selected: string | null): Promise<HTMLElement> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  await act(async () => {
    createRoot(el).render(React.createElement(GapThreads, { threads: [thread as never], onSelect: () => {}, selectedDispatchId: selected }));
  });
  return el;
}

describe("gap attempts", () => {
  test("must-fail: repeated refusals with no run fold into one line; one with a run stays its own", () => {
    const f = foldAttempts(attempts as never);
    expect(f.map((x) => [x.first.attemptId, x.count])).toEqual([["a5", 3], ["a2", 1], ["a1", 1]]);
  });

  test("must-fail: with nothing on screen, no gap opens itself", async () => {
    const el = await mount(null);
    expect(el.querySelector("details")?.hasAttribute("open")).toBe(false);
  });

  test("the gap holding the run on screen opens, and the folded line reads its span and count", async () => {
    const el = await mount("d-run");
    expect(el.querySelector("details")?.hasAttribute("open")).toBe(true);
    const first = el.querySelector(".sf-gap-attempts li")!;
    expect(first.textContent).toContain("10-26 07:00 – 10-26 07:21");
    expect(first.textContent).toContain("×3");
    expect(el.querySelectorAll(".sf-gap-attempts li").length).toBe(4);
  });
});
