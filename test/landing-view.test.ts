/**
 * The landing draws the blocks its view names, in the view's order, and leaves out a
 * block with nothing to show. With no view, or one naming a block this build cannot
 * draw, it draws its default: the newest own run. Its rows select what to look at and
 * send nothing.
 *
 * Shapes: one node 10-26: five open decisions, the person's own runs all "record gone",
 * the trace store gap at 875 attempts with none landed.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://surface.test/" });

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { teardownDom, trackRoot } from "./setup.ts";

const posts: string[] = [];
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (init?.method === "POST") posts.push(url);
  if (url.includes("/api/questions")) return Response.json({ resolved: true, success: true, body: { questions: [] } });
  if (url.includes("/api/resolve")) {
    return Response.json({ resolved: true, shape: "goalWalkState", body: {
      dispatchId: "d-latest", goal: "What time is it?", status: "completed", reached: true, goalReachReason: null, poolShapes: [], poolProvenance: [],
      pendingTargets: [], poolEvents: [], walkLog: [], currentStep: null, steps: [], executionPath: null, walkTier: null, attemptCount: null,
      grounded: null, learning: null, answerBody: null, operator: "human-surface", completionShapes: null, humanGraded: false, humanReachNotes: null, trigger: null, requeueOf: null,
    } });
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
const { Landing, landingBlocks, stuckTitle } = await import("../ui/src/components/Landing");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterAll(async () => {
  await teardownDom();
});
beforeEach(() => {
  posts.length = 0;
});

const ask = (id: string, gap: string) => ({
  id, revision: 1, title: "Question", body: `Gap ${gap} (unreachable_producer) has failed auto-repair 8+ times. Summary: ${gap}`,
  createdAt: 0, updatedAt: 0, responses: [], answers: [], answered: false, declined: false, kind: "gap_needs_human",
});
const decisions = [
  ask("q1", "reach-gap-docs-align-tick"),
  ask("q2", "cold-boot-silently-skips-twenty-two-unparseable-migration-files"),
  ask("q3", "escalations-were-asked-of-a-vessel-no-human-reads"),
  ask("q4", "region-lint-is-never-scheduled-so-bad-armed-regions-surface"),
  ask("q5", "reach-gap-capability-gap-audit"),
];
const gone = { dispatchId: "d-gone", goal: "Where are we?", operator: "human-surface", status: "gone", reached: null, startedAt: "2026-10-21T10:00:00Z" };
const systemRuns = [
  { dispatchId: "s1", goal: "reconcile the trace store", operator: null, trigger: "run-goal", status: "failed", reached: false, startedAt: "2026-10-26T07:00:00Z" },
  { dispatchId: "s2", goal: "What time is it?", operator: null, trigger: "run-goal", status: "completed", reached: true, startedAt: "2026-10-26T07:01:00Z" },
];
const stuck = [{ gapId: "trace-store-over-cap", summary: "Trace store over its cap", status: "open", reopenCount: 0, attempts: [], attemptCount: 875, landedCount: 0, lastAt: null }];
const view = (blocks: string[], limits: Record<string, number> = {}, revision = 1) => ({ region: "landing", revision, id: `landing@${revision}`, blocks, limits });

async function mount(props: Record<string, unknown>, calls: string[] = []): Promise<HTMLElement> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const all = {
    view: undefined, ordered: decisions, board: [gone, ...systemRuns], gapThreads: stuck, latest: "d-latest",
    onOpenRun: (id: string) => calls.push(`run:${id}`), onOpenQuestion: (id: string) => calls.push(`question:${id}`), onOpenSystem: () => calls.push("system"),
    ...props,
  };
  await act(async () => {
    createRoot(el).render(React.createElement(QueryClientProvider, { client: qc },
      React.createElement(LiveControlsProvider, null, React.createElement(QuestionsProvider, null, React.createElement(Landing, all as never)))));
  });
  for (let i = 0; i < 3; i++) await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
  return el;
}

const blocksDrawn = (el: HTMLElement): string[] => [...el.querySelectorAll("[data-block]")].map((b) => b.getAttribute("data-block")!);

describe("the landing drawn from its view", () => {
  test("with no view, the landing draws its default: the newest own run", async () => {
    const el = await mount({});
    expect(blocksDrawn(el)).toEqual(["latest_run"]);
    expect(el.querySelector(".sf-landing")?.getAttribute("data-view-id")).toBe("landing@0");
    expect(el.textContent).toContain("What time is it?");
  });

  test("must-fail: a view's blocks are drawn in its order, and the landing names the view it drew", async () => {
    const el = await mount({ view: view(["health", "needs_you"], {}, 3) });
    expect(blocksDrawn(el)).toEqual(["health", "needs_you"]);
    const root = el.querySelector(".sf-landing")!;
    expect(root.getAttribute("data-view-id")).toBe("landing@3");
    expect(root.getAttribute("data-view-revision")).toBe("3");
    expect(el.querySelector("[data-block=health]")?.textContent).toContain("1 / 2");
    expect(el.querySelector("[data-block=health]")?.textContent).toContain("875 attempts");
  });

  test("must-fail: a block with nothing to show is left out (the person's runs are all gone)", async () => {
    const el = await mount({ view: view(["needs_you", "changed", "health"]) });
    expect(blocksDrawn(el)).toEqual(["needs_you", "health"]);
  });

  test("must-fail: the needs_you limit is the view's", async () => {
    const el = await mount({ view: view(["needs_you"], { needs_you: 3 }) });
    expect(el.querySelectorAll("[data-block=needs_you] li").length).toBe(3);
    const all = await mount({ view: view(["needs_you"]) });
    expect(all.querySelectorAll("[data-block=needs_you] li").length).toBe(5);
  });

  test("must-fail: a view naming a block this build cannot draw falls back to the default", async () => {
    const el = await mount({ view: view(["health", "weather"]) });
    expect(blocksDrawn(el)).toEqual(["latest_run"]);
    expect(el.querySelector(".sf-landing")?.getAttribute("data-view-default")).toBe("true");
    expect(landingBlocks(view(["health", "weather"]) as never).fromView).toBe(false);
  });

  test("rows select and send nothing", async () => {
    const calls: string[] = [];
    const el = await mount({ view: view(["needs_you", "health"]) }, calls);
    await act(async () => (el.querySelector("[data-block=needs_you] button") as HTMLButtonElement).click());
    await act(async () => (el.querySelector("[data-block=health] button") as HTMLButtonElement).click());
    expect(calls).toEqual(["question:q1", "system"]);
    expect(posts.filter((u) => !u.includes("/api/resolve") && !u.includes("/api/observations"))).toEqual([]);
  });

  test("must-fail: what the system is stuck on reads as the gap, not its evidence", () => {
    const t = { ...stuck[0]!, summary: "Trace store row_count=312744 exceeds cap=150000 (last_reconciled_at=2026-10-26T07:02:01Z). Reconcile runs every 10 min." };
    expect(stuckTitle(t as never)).toBe("Trace store row_count=312744 exceeds cap=150000");
    expect(stuckTitle({ ...t, summary: "Reach gap docs align tick" } as never)).toBe("Reach gap docs align tick");
    expect(stuckTitle({ ...t, summary: null } as never)).toBe("trace-store-over-cap");
  });
});
