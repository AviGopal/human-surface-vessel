/**
 * A run whose reach waits for a person's verdict is listed where a person reads, and
 * opens the run, whose Grade section is the one grading flow (/api/grade). Before this
 * the deferral lived only in goal-host's record: nothing asked anyone.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://surface.test/" });

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { teardownDom, trackRoot } from "./setup.ts";

const NOW = Date.now();
const at = (m: number): string => new Date(NOW - m * 60_000).toISOString();
const open = (executionId: string, originator: "system" | "operator" | null, expiresInMin: number) => ({
  executionId, state: "open", deferredAt: NOW - 5 * 60_000, expiresAt: NOW + expiresInMin * 60_000, originator,
});

/** What the awaiting read answers; what the board answers. Reset per test. */
let awaitingRows: unknown[] = [];
let boardRows: unknown[] = [];
const awaitingReads: Record<string, unknown>[] = [];

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
  if (url.includes("/api/questions")) return new Response(JSON.stringify({ resolved: true, success: true, body: { questions: [] } }), { status: 200 });
  if (url.includes("/api/verdicts")) return new Response(JSON.stringify({ body: { verdicts: [] } }), { status: 200 });
  if (body["type"] === "activeDispatches") {
    if (body["awaiting"] !== undefined) awaitingReads.push(body);
    const dispatches = body["awaiting"] === "person_verdict" ? awaitingRows : boardRows;
    return new Response(JSON.stringify({ resolved: true, shape: "activeDispatches", body: { dispatches } }), { status: 200 });
  }
  return new Response("{}", { status: 200 });
}) as typeof fetch;

const uiSrc = new URL("../ui/src/", import.meta.url).pathname;
const React = await import(Bun.resolveSync("react", uiSrc));
const { createRoot: rawCreateRoot } = await import(Bun.resolveSync("react-dom/client", uiSrc));
const createRoot = (...a: Parameters<typeof rawCreateRoot>) => trackRoot(rawCreateRoot(...a));
const { act } = React;
const { QueryClient, QueryClientProvider } = await import(Bun.resolveSync("@tanstack/react-query", uiSrc));
const { LiveControlsProvider } = await import("../ui/src/state/liveControls");
const { QuestionsProvider } = await import("../ui/src/state/questions");
const { RunsList } = await import("../ui/src/components/RunsList");
const { gradeState } = await import("../ui/src/components/RunView");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterAll(async () => {
  await teardownDom();
});
beforeEach(() => {
  awaitingRows = [];
  boardRows = [];
  awaitingReads.length = 0;
});

async function rail(selected: string[]): Promise<HTMLElement> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  await act(async () => {
    root.render(React.createElement(QueryClientProvider, { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
      React.createElement(LiveControlsProvider, null, React.createElement(QuestionsProvider, null, React.createElement(RunsList, { selectedDispatchId: null, onSelect: (d: string) => selected.push(d), filter: "all" })))));
  });
  for (let i = 0; i < 4; i++) await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
  return el;
}

describe("runs awaiting a person's verdict", () => {
  test("must-fail: a pending verdict is listed, asked for with the server-side filter, and opens its run to grade", async () => {
    awaitingRows = [
      { dispatchId: "d-self", goal: "summarise the night's gaps", status: "completed", reached: true, startedAt: at(20), executionId: "exec-self", personVerdict: open("exec-self", "system", 40) },
      { dispatchId: "d-op", goal: "list the vessels serving trace reads", status: "completed", reached: true, startedAt: at(90), executionId: "exec-op", personVerdict: open("exec-op", "operator", 3 * 24 * 60) },
    ];
    boardRows = [{ dispatchId: "d-plain", goal: "a run nobody is asked about", status: "completed", reached: true, startedAt: at(1) }];
    const selected: string[] = [];
    const el = await rail(selected);
    expect(awaitingReads.length).toBeGreaterThan(0);
    expect(awaitingReads[0]).toEqual({ type: "activeDispatches", awaiting: "person_verdict" });
    const section = el.querySelector(".sf-awaiting-verdicts");
    expect(section?.querySelector(".sf-awaiting-head")?.textContent).toBe("Awaiting your verdict · 2");
    const items = [...(section?.querySelectorAll("li") ?? [])];
    expect(items.map((li) => li.getAttribute("data-dispatch-id"))).toEqual(["d-self", "d-op"]);
    expect(items.map((li) => li.getAttribute("data-execution-id"))).toEqual(["exec-self", "exec-op"]);
    expect(items[0]?.textContent).toContain("the system's own goal");
    expect(items[0]?.textContent).toContain("lapses in 40 min");
    expect(items[1]?.textContent).not.toContain("the system's own goal");
    expect(items[1]?.textContent).toContain("lapses in 3 d");
    // The plain run is on the board, never in the awaiting list.
    expect(section?.textContent).not.toContain("a run nobody is asked about");
    await act(async () => {
      (items[1]?.querySelector("button") as HTMLButtonElement).click();
    });
    expect(selected).toEqual(["d-op"]);
  });

  test("control: no open deferral, no section; a goal-host that ignores the filter lists nothing", async () => {
    // Rows a goal-host without the filter would return: the newest runs, none carrying an open personVerdict.
    awaitingRows = [
      { dispatchId: "d-plain", goal: "a run nobody is asked about", status: "completed", reached: true, startedAt: at(1) },
      { dispatchId: "d-done", goal: "already decided", status: "completed", reached: true, startedAt: at(2), personVerdict: { ...open("exec-done", null, 10), state: "delivered" } },
    ];
    const el = await rail([]);
    expect(awaitingReads.length).toBeGreaterThan(0);
    expect(el.querySelector(".sf-awaiting-verdicts")).toBeNull();
  });

  test("must-fail: a run whose reach waits for a person is graded with both verdicts, not only a dispute", () => {
    expect(gradeState("reached", open("e", "operator", 60) as never)).toBe("ungraded");
    // Control: a decided or absent deferral keeps the rendered verdict's options.
    expect(gradeState("reached", { ...open("e", "operator", 60), state: "delivered" } as never)).toBe("reached");
    expect(gradeState("reached", undefined)).toBe("reached");
    expect(gradeState("not-reached", null)).toBe("not-reached");
  });
});
