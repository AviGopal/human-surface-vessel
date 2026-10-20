/**
 * Repeated asks share one line with their history. Shapes: one node, 10-13 → 10-17,
 * one GitHub ask ran 7 times (6 not reached, 1 reached) and drew 7 identical rows.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://surface.test/" });

import { afterAll, describe, expect, test } from "bun:test";
import { teardownDom, trackRoot } from "./setup.ts";

let dispatches: unknown[] = [];
let verdicts: unknown[] = [];
globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
  const ask = JSON.parse(String(init?.body ?? "{}")) as { type?: string };
  if (String(_input).includes("/api/questions")) return new Response(JSON.stringify({ resolved: true, success: true, body: { questions: [] } }), { status: 200 });
  if (String(_input).includes("/api/verdicts")) return new Response(JSON.stringify({ body: { verdicts } }), { status: 200 });
  if (String(_input).includes("/api/mine")) return new Response(JSON.stringify({ dispatches: [] }), { status: 200 });
  if (ask.type === "activeDispatches") return new Response(JSON.stringify({ resolved: true, shape: "activeDispatches", body: { dispatches } }), { status: 200 });
  return new Response("{}", { status: 200 });
}) as typeof fetch;

const uiSrc = new URL("../ui/src/", import.meta.url).pathname;
const from = (spec: string): string => Bun.resolveSync(spec, uiSrc);
const React = await import(from("react"));
const { createRoot: rawCreateRoot } = await import(from("react-dom/client"));
const createRoot = (...a: Parameters<typeof rawCreateRoot>) => trackRoot(rawCreateRoot(...a));
const { act } = React;
const { QueryClient, QueryClientProvider } = await import(from("@tanstack/react-query"));
const { LiveControlsProvider } = await import("../ui/src/state/liveControls");
const { QuestionsProvider } = await import("../ui/src/state/questions");
const { RunsList } = await import("../ui/src/components/RunsList");
const { groupThreads, learningMark, personReachedByRun, threadKey } = await import("../ui/src/lib/threads");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let lastClient: InstanceType<typeof QueryClient> | null = null;

async function mount(node: unknown): Promise<HTMLElement> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  lastClient = qc;
  await act(async () => {
    createRoot(el).render(React.createElement(QueryClientProvider, { client: qc }, React.createElement(LiveControlsProvider, null, React.createElement(QuestionsProvider, null, node as never))));
  });
  for (let i = 0; i < 3; i++) await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
  return el;
}

afterAll(async () => {
  await teardownDom();
});

const run = (id: string, at: number, reached: boolean | null, goal = "What is on GitHub?", status = "completed") => ({ dispatchId: id, startedAtMs: at, goal, reached, status });

describe("threads", () => {
  test("case, spacing and closing punctuation do not split an ask", () => {
    expect(threadKey("  What is on  GitHub? ")).toBe(threadKey("what is on github"));
    expect(threadKey("Check the network")).not.toBe(threadKey("Check the networking"));
  });

  test("a thread sits where its newest run sits; its runs are newest first", () => {
    const t = groupThreads([run("a", 1, false), run("b", 2, true, "Other"), run("c", 3, true)]);
    expect(t.map((x) => x.runs.map((r) => r.dispatchId))).toEqual([["c", "a"], ["b"]]);
  });

  test("the mark counts judged runs only, oldest first, and names a change of outcome", () => {
    const m = learningMark([run("c", 3, true), run("b", 2, false), run("a", 1, false), run("d", 4, null, undefined, "running")]);
    expect(m.marks).toEqual(["missed", "missed", "reached", "open"]);
    expect([m.reached, m.judged, m.trend]).toEqual([1, 3, "learned"]);
    expect(learningMark([run("a", 1, true), run("b", 2, false)]).trend).toBe("lost");
    expect(learningMark([run("a", 1, false), run("b", 2, false)]).trend).toBeNull();
  });

  const at = (m: number): string => new Date(Date.UTC(2026, 9, 15, 10, m)).toISOString();
  const seven = () => [
    ...[1, 2, 3, 4, 5, 6].map((m) => ({ dispatchId: `g${m}`, goal: "What is on GitHub?", operator: "human-surface", status: "completed", reached: false, startedAt: at(m) })),
    { dispatchId: "g7", goal: "what is on github", operator: "human-surface", status: "completed", reached: true, startedAt: at(7) },
    { dispatchId: "w", goal: "Weather in Seattle", operator: "human-surface", status: "completed", reached: true, startedAt: at(8) },
  ];
  const ids = (el: HTMLElement): (string | null)[] => [...el.querySelectorAll(".sf-run-row")].map((r) => r.getAttribute("data-dispatch-id"));

  test("must-fail: seven runs of one ask draw one line with its history and no extra lines", async () => {
    dispatches = seven();
    const el = await mount(React.createElement(RunsList, { selectedDispatchId: null, onSelect: () => {}, filter: "mine" }));
    expect(ids(el)).toEqual(["w", "g7"]);
    const mark = el.querySelector("[data-dispatch-id='g7'] .sf-thread-mark");
    expect(mark?.getAttribute("aria-label")).toBe("1 of 7 reached, now reaches");
    expect(mark?.querySelectorAll(".sf-thread-dot").length).toBe(7);
    // A run asked once has no mark.
    expect(el.querySelector("[data-dispatch-id='w'] .sf-thread-mark")).toBeNull();
  });

  test("an open thread lists its earlier runs under the newest, newest first", async () => {
    for (const selected of ["g7", "g3"]) {
      const el = await mount(React.createElement(RunsList, { selectedDispatchId: selected, onSelect: () => {}, filter: "mine" }));
      const earlier = el.querySelector(".sf-thread-earlier");
      expect([...earlier!.querySelectorAll(".sf-run-row")].map((r) => r.getAttribute("data-dispatch-id"))).toEqual(["g6", "g5", "g4", "g3", "g2", "g1"]);
    }
  });

  test("a repeat accepted at the top takes its thread's line: the earlier head folds in, nothing else moves", async () => {
    dispatches = seven();
    const el = await mount(React.createElement(RunsList, { selectedDispatchId: null, onSelect: () => {}, filter: "mine" }));
    expect(ids(el)).toEqual(["w", "g7"]);
    dispatches = [...seven(), { dispatchId: "g8", goal: "What is on GitHub?", operator: "human-surface", status: "running", reached: null, startedAt: at(9) }];
    await act(async () => {
      await lastClient!.refetchQueries();
    });
    for (let i = 0; i < 3; i++) await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(ids(el)).toEqual(["g8", "w"]);
    expect(el.querySelector("[data-dispatch-id='g8'] .sf-thread-mark")?.getAttribute("aria-label")).toBe("1 of 7 reached, now reaches");
  });

  test("a person's verdict against the judge marks the run disputed; the latest verdict counts", () => {
    const said = personReachedByRun([
      { dispatch_id: "a", verdict: "achieved", observedAt: 1 },
      { dispatch_id: "a", verdict: "not_achieved", observedAt: 2 },
      { dispatch_id: "b", verdict: "partial", observedAt: 1 },
    ]);
    expect([...said]).toEqual([["a", false]]);
    const m = learningMark([run("a", 1, true), run("b", 2, false)], said);
    expect(m.said).toEqual(["disagree", null]);
    expect(m.disputed).toBe(1);
  });

  test("must-fail: a run asked once that a person disputed carries a mark saying so", async () => {
    dispatches = [{ dispatchId: "r1", goal: "Where is it raining?", operator: "human-surface", status: "completed", reached: true, startedAt: at(20) }];
    verdicts = [{ dispatch_id: "r1", verdict: "not_achieved", note: "Wrong answer", source: "person", judge_reached: true, observedAt: 5 }];
    const el = await mount(React.createElement(RunsList, { selectedDispatchId: null, onSelect: () => {}, filter: "mine" }));
    const mark = el.querySelector("[data-dispatch-id='r1'] .sf-thread-mark");
    expect(mark?.getAttribute("aria-label")).toBe("1 of 1 reached, 1 disputed by you");
    expect(mark?.querySelector(".sf-thread-dot")?.getAttribute("data-said")).toBe("disagree");
    verdicts = [];
  });
});
