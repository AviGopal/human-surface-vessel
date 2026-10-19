/** Under System, each gap is one thread; a lane run that belongs to a gap is drawn inside it and nowhere else. */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://surface.test/" });

import { afterAll, describe, expect, test } from "bun:test";

const at = (m: number): string => new Date(Date.UTC(2026, 9, 18, 6, m)).toISOString();
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  const body = JSON.parse(String(init?.body ?? "{}")) as { type?: string };
  if (url.includes("/api/questions")) return new Response(JSON.stringify({ resolved: true, success: true, body: { questions: [] } }), { status: 200 });
  if (url.includes("/api/verdicts")) return new Response(JSON.stringify({ body: { verdicts: [] } }), { status: 200 });
  if (url.includes("/api/gap-threads")) {
    return new Response(JSON.stringify({ body: { scope: "this node", threads: [
      { gapId: "trace-store-reconcile-2026-09-30T16", summary: null, status: "open", reopenCount: 0, attemptCount: 737, landedCount: 0, lastAt: at(30),
        attempts: [{ attemptId: "a2", at: at(30), route: "gap_to_feature", stage: "compose", dispatchId: "d-lane", outcome: "refused", verdict: "BUSY", landed: false, commit: null },
                   { attemptId: "a1", at: at(10), route: "gap_to_feature", stage: null, dispatchId: null, outcome: "refused", verdict: null, landed: false, commit: null }] },
    ] } }), { status: 200 });
  }
  if (body.type === "activeDispatches") {
    return new Response(JSON.stringify({ resolved: true, shape: "activeDispatches", body: { dispatches: [
      { dispatchId: "d-lane", goal: "investigate and decompose: reconcile the trace store", operator: null, trigger: "gap-closing", status: "completed", reached: false, startedAt: at(29) },
      { dispatchId: "d-other", goal: "refresh the reality model", operator: "rhythm-conductor-drain", status: "completed", reached: true, startedAt: at(20) },
    ] } }), { status: 200 });
  }
  return new Response("{}", { status: 200 });
}) as typeof fetch;

const uiSrc = new URL("../ui/src/", import.meta.url).pathname;
const React = await import(Bun.resolveSync("react", uiSrc));
const { createRoot } = await import(Bun.resolveSync("react-dom/client", uiSrc));
const { act } = React;
const { QueryClient, QueryClientProvider } = await import(Bun.resolveSync("@tanstack/react-query", uiSrc));
const { LiveControlsProvider } = await import("../ui/src/state/liveControls");
const { QuestionsProvider } = await import("../ui/src/state/questions");
const { RunsList } = await import("../ui/src/components/RunsList");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: { unmount: () => void }[] = [];
afterAll(async () => {
  await act(async () => {
    for (const r of roots) r.unmount();
  });
  await GlobalRegistrator.unregister();
});

describe("gap threads in the rail", () => {
  test("must-fail: under System, a gap is one thread, and its lane run is drawn only inside it", async () => {
    const selected: string[] = [];
    const el = document.createElement("div");
    document.body.appendChild(el);
    const root = createRoot(el);
    roots.push(root);
    await act(async () => {
      root.render(React.createElement(QueryClientProvider, { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
        React.createElement(LiveControlsProvider, null, React.createElement(QuestionsProvider, null, React.createElement(RunsList, { selectedDispatchId: null, onSelect: (d: string) => selected.push(d), filter: "system" })))));
    });
    for (let i = 0; i < 4; i++) await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    const thread = el.querySelector(".sf-gap-thread");
    expect(thread?.querySelector(".sf-gap-mark")?.textContent).toBe("open · 737 attempts · 0 landed");
    expect(thread?.querySelector(".sf-gap-title")?.textContent).toBe("trace store reconcile");
    const rows = [...el.querySelectorAll(".sf-run-row")].map((r) => r.getAttribute("data-dispatch-id"));
    expect(rows).toEqual(["d-other"]);
    expect(thread?.textContent).toContain("no run recorded");
    // The rail doesn't explain what it can't read (16g; the interface does not explain itself).
    expect(thread?.textContent).not.toContain("not readable");
    await act(async () => {
      (thread?.querySelector("button") as HTMLButtonElement).click();
    });
    expect(selected).toEqual(["d-lane"]);
  });
});
