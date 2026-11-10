/**
 * The landing draws the blocks its view names, in the view's order, and leaves out a
 * block with nothing to show. With no view, or one naming a block this build cannot
 * draw, it draws its default: open questions. Its rows select what to look at and
 * send nothing.
 *
 * Shapes: one node 10-26: five open decisions. Reports: answers as two nodes
 * gave them 11-10 (a load report; a forward that timed out; a peer refusing a keyless read).
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://surface.test/" });

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { teardownDom, trackRoot } from "./setup.ts";

const posts: string[] = [];
const reportPointers: unknown[] = [];
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.includes("/api/discovery/resolve")) {
    const pointer = JSON.parse(String(init?.body)).pointer as { type: string };
    reportPointers.push(pointer);
    if (pointer.type === "system_load_report") {
      return Response.json({ success: true, shape: "systemLoadReport", body: { load_avg_1m: 2.61, load_avg_5m: 2.11, cpu_cores: 16, anomalies: [] } });
    }
    if (pointer.type === "reach_rate_scan") return Response.json({ error: "forward_failed", shape: "reach_rate_scan", detail: "The operation timed out." }, { status: 502 });
    return Response.json({ content: { error: "unauthorized", shape: pointer.type, reason: "absent" }, metadata: {} });
  }
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
const { Landing, landingBlocks } = await import("../ui/src/components/Landing");

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
const view = (blocks: string[], limits: Record<string, number> = {}, revision = 1) => ({ region: "landing", revision, id: `landing@${revision}`, blocks, limits });

async function mount(props: Record<string, unknown>, calls: string[] = []): Promise<HTMLElement> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const all = {
    view: undefined, ordered: decisions,
    onOpenQuestion: (id: string) => calls.push(`question:${id}`),
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
  test("with no view read, the landing draws what the page holds itself: open questions", async () => {
    const el = await mount({});
    expect(blocksDrawn(el)).toEqual(["needs_you"]);
    expect(el.querySelector(".sf-landing")?.getAttribute("data-view-id")).toBe("landing@0");
  });

  test("must-fail: the reports block draws each named report's answer, and says why one has none", async () => {
    const el = await mount({ view: { ...view(["reports"]), reports: [{ type: "system_load_report" }, { type: "reach_rate_scan" }, { type: "substrateGap", limit: 2 }] } });
    expect(blocksDrawn(el)).toEqual(["reports"]);
    const load = el.querySelector("[data-report=system_load_report]")!;
    expect(load.textContent).toContain("system load report");
    expect(load.textContent).toContain("load avg 1m");
    expect(load.textContent).toContain("2.61");
    expect(el.querySelector("[data-report=reach_rate_scan]")!.textContent).toContain("no answer: forward_failed: The operation timed out.");
    const gaps = el.querySelector("[data-report=substrateGap]")!;
    expect(gaps.textContent).toContain("no answer: unauthorized: absent");
    // Reading a report is a read: nothing on this screen sends a write.
    expect(reportPointers).toEqual([{ type: "system_load_report" }, { type: "reach_rate_scan" }, { type: "substrateGap", limit: 2 }]);
  });

  test("must-fail: a view's blocks are drawn in its order, and the landing names the view it drew", async () => {
    const el = await mount({ view: { ...view(["reports", "needs_you"], {}, 3), reports: [{ type: "system_load_report" }] } });
    expect(blocksDrawn(el)).toEqual(["reports", "needs_you"]);
    const root = el.querySelector(".sf-landing")!;
    expect(root.getAttribute("data-view-id")).toBe("landing@3");
    expect(root.getAttribute("data-view-revision")).toBe("3");
  });

  test("must-fail: a block with nothing to show is left out (no open questions)", async () => {
    const el = await mount({ view: { ...view(["needs_you", "reports"]), reports: [{ type: "system_load_report" }] }, ordered: [] });
    expect(blocksDrawn(el)).toEqual(["reports"]);
  });

  test("must-fail: the blocks only goal-host could fill are gone: a view naming one is not drawn", async () => {
    for (const gone of ["latest_run", "changed", "health"]) {
      const el = await mount({ view: view(["needs_you", gone]) });
      expect(blocksDrawn(el)).toEqual(["needs_you"]);
      expect(el.querySelector(".sf-landing")?.getAttribute("data-view-default")).toBe("true");
    }
  });

  test("must-fail: the needs_you limit is the view's", async () => {
    const el = await mount({ view: view(["needs_you"], { needs_you: 3 }) });
    expect(el.querySelectorAll("[data-block=needs_you] li").length).toBe(3);
    const all = await mount({ view: view(["needs_you"]) });
    expect(all.querySelectorAll("[data-block=needs_you] li").length).toBe(5);
  });

  test("must-fail: a view naming a block this build cannot draw falls back to the default", async () => {
    const el = await mount({ view: view(["reports", "weather"]) });
    expect(blocksDrawn(el)).toEqual(["needs_you"]);
    expect(el.querySelector(".sf-landing")?.getAttribute("data-view-default")).toBe("true");
    expect(landingBlocks(view(["reports", "weather"]) as never).fromView).toBe(false);
  });

  test("rows select and send nothing", async () => {
    const calls: string[] = [];
    const el = await mount({ view: view(["needs_you"]) }, calls);
    await act(async () => (el.querySelector("[data-block=needs_you] button") as HTMLButtonElement).click());
    expect(calls).toEqual(["question:q1"]);
    expect(posts.filter((u) => !u.includes("/api/observations"))).toEqual([]);
  });
});
