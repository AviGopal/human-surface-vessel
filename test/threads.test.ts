/**
 * Repeated asks share one line with their history. Shapes: one node, 10-13 → 10-17,
 * one GitHub ask ran 7 times (6 not reached, 1 reached) and drew 7 identical rows.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://surface.test/" });

import { afterAll, describe, expect, test } from "bun:test";

let dispatches: unknown[] = [];
globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
  const ask = JSON.parse(String(init?.body ?? "{}")) as { type?: string };
  if (String(_input).includes("/api/questions")) return new Response(JSON.stringify({ resolved: true, success: true, body: { questions: [] } }), { status: 200 });
  if (String(_input).includes("/api/mine")) return new Response(JSON.stringify({ dispatches: [] }), { status: 200 });
  if (ask.type === "activeDispatches") return new Response(JSON.stringify({ resolved: true, shape: "activeDispatches", body: { dispatches } }), { status: 200 });
  return new Response("{}", { status: 200 });
}) as typeof fetch;

const uiSrc = new URL("../ui/src/", import.meta.url).pathname;
const from = (spec: string): string => Bun.resolveSync(spec, uiSrc);
const React = await import(from("react"));
const { createRoot } = await import(from("react-dom/client"));
const { act } = React;
const { QueryClient, QueryClientProvider } = await import(from("@tanstack/react-query"));
const { LiveControlsProvider } = await import("../ui/src/state/liveControls");
const { QuestionsProvider } = await import("../ui/src/state/questions");
const { RunsList } = await import("../ui/src/components/RunsList");
const { groupThreads, learningMark, threadKey } = await import("../ui/src/lib/threads");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function mount(node: unknown): Promise<HTMLElement> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    createRoot(el).render(React.createElement(QueryClientProvider, { client: qc }, React.createElement(LiveControlsProvider, null, React.createElement(QuestionsProvider, null, node as never))));
  });
  for (let i = 0; i < 3; i++) await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
  return el;
}

afterAll(async () => {
  await GlobalRegistrator.unregister();
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

  test("must-fail: seven runs of one ask draw one line with its history; earlier runs fold under it", async () => {
    const at = (m: number): string => new Date(Date.UTC(2026, 9, 15, 10, m)).toISOString();
    dispatches = [
      ...[1, 2, 3, 4, 5, 6].map((m) => ({ dispatchId: `g${m}`, goal: "What is on GitHub?", operator: "human-surface", status: "completed", reached: false, startedAt: at(m) })),
      { dispatchId: "g7", goal: "what is on github", operator: "human-surface", status: "completed", reached: true, startedAt: at(7) },
      { dispatchId: "w", goal: "Weather in Seattle", operator: "human-surface", status: "completed", reached: true, startedAt: at(8) },
    ];
    const el = await mount(React.createElement(RunsList, { selectedDispatchId: null, onSelect: () => {}, filter: "mine" }));
    const outside = [...el.querySelectorAll(".sf-run-row")].filter((r) => !r.closest("details")).map((r) => r.getAttribute("data-dispatch-id"));
    expect(outside).toEqual(["w", "g7"]);
    const thread = el.querySelector(".sf-thread")!;
    expect(thread.querySelector(".sf-thread-mark")?.getAttribute("aria-label")).toBe("1 of 7 reached, now reaches");
    expect(thread.querySelectorAll(".sf-thread-dot").length).toBe(7);
    const fold = thread.querySelector("details.sf-thread-earlier")!;
    expect(fold.querySelector("summary")?.textContent).toBe("Earlier · 6");
    expect(fold.hasAttribute("open")).toBe(false);
    // A run asked once has no mark.
    expect(el.querySelector("[data-dispatch-id='w'] .sf-thread-mark")).toBeNull();
  });

  test("the fold opens when the selected run is an earlier one", async () => {
    const el = await mount(React.createElement(RunsList, { selectedDispatchId: "g3", onSelect: () => {}, filter: "mine" }));
    expect(el.querySelector("details.sf-thread-earlier")?.hasAttribute("open")).toBe(true);
  });
});
