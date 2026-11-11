/**
 * The landing draws the entries its view names, in the view's order, each in the form the
 * entry names, and every entry says why when it has no answer. The page holds no default
 * of its own and names no section: titles are the view's, else the shape's name. The view
 * in force is named, and a newer view that was passed over is named with its reason.
 *
 * Shapes: one node 10-26: five open decisions. Answers as two nodes gave them 11-10 (a load
 * report; a forward that timed out; a peer refusing a keyless read).
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://surface.test/" });

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { teardownDom, trackRoot } from "./setup.ts";

const ask = (id: string, gap: string) => ({
  id, revision: 1, title: `Gap ${gap} needs a person`, body: `Gap ${gap} (unreachable_producer) has failed auto-repair 8+ times.`,
  createdAt: 0, updatedAt: 0, responses: [], answers: [], answered: false, declined: false, kind: "gap_needs_human",
});
const decisions = [
  ask("q1", "reach-gap-docs-align-tick"),
  ask("q2", "cold-boot-silently-skips-twenty-two-unparseable-migration-files"),
  ask("q3", "escalations-were-asked-of-a-vessel-no-human-reads"),
];

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
    if (pointer.type === "uiQuestion") return Response.json({ success: true, shape: "uiQuestion", body: { questions: decisions, total: 3 } });
    if (pointer.type === "record_read") {
      return Response.json({ success: true, shape: "record_read", body: [1, 2, 3, 4, 5].map((n) => ({ id: `w${n}`, seq: n, shape: "world_changed", what: `ask ${n}` })) });
    }
    if (pointer.type === "weather_report") return Response.json({ success: true, shape: "weather_report", body: { sky: "clear" } });
    if (pointer.type === "reach_rate_scan") return Response.json({ error: "forward_failed", shape: "reach_rate_scan", detail: "The operation timed out." }, { status: 502 });
    return Response.json({ content: { error: "unauthorized", shape: pointer.type, reason: "absent" }, metadata: {} });
  }
  if (init?.method === "POST") posts.push(url);
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
const { Landing } = await import("../ui/src/components/Landing");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterAll(async () => {
  await teardownDom();
});
beforeEach(() => {
  posts.length = 0;
  reportPointers.length = 0;
});

const view = (entries: unknown[], revision = 1, extra: Record<string, unknown> = {}) => ({ region: "landing", revision, id: `landing@${revision}`, entries, notDrawn: null, ...extra });

async function mount(props: Record<string, unknown>, calls: string[] = []): Promise<HTMLElement> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const all = { view: undefined, onOpenQuestion: (id: string) => calls.push(`question:${id}`), ...props };
  await act(async () => {
    createRoot(el).render(React.createElement(QueryClientProvider, { client: qc },
      React.createElement(LiveControlsProvider, null, React.createElement(QuestionsProvider, null, React.createElement(Landing, all as never)))));
  });
  for (let i = 0; i < 3; i++) await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
  return el;
}

const drawn = (el: HTMLElement): string[] => [...el.querySelectorAll("[data-report]")].map((b) => b.getAttribute("data-report")!);

describe("the landing drawn from its view", () => {
  test("must-fail: with no view read, the page draws no list of its own and says why", async () => {
    const reading = await mount({});
    expect(drawn(reading)).toEqual([]);
    expect(reading.textContent).toContain("Reading the view");
    const failed = await mount({ viewError: "view unavailable (502)" });
    expect(failed.textContent).toContain("The view could not be read: view unavailable (502)");
    expect(reportPointers).toEqual([]);
  });

  test("must-fail: each entry's answer is drawn, and one with none says why", async () => {
    const el = await mount({ view: view([
      { pointer: { type: "system_load_report" }, form: "fields" },
      { pointer: { type: "reach_rate_scan" }, form: "fields" },
      { pointer: { type: "substrateGap", limit: 2 }, form: "rows" },
    ]) });
    const load = el.querySelector("[data-report=system_load_report]")!;
    expect(load.textContent).toContain("system load report");
    expect(load.textContent).toContain("load avg 1m");
    expect(load.textContent).toContain("2.61");
    expect(el.querySelector("[data-report=reach_rate_scan]")!.textContent).toContain("no answer: forward_failed: The operation timed out.");
    expect(el.querySelector("[data-report=substrateGap]")!.textContent).toContain("no answer: unauthorized: absent");
    // Only the pointer is sent; drawing is a read.
    expect(reportPointers).toEqual([{ type: "system_load_report" }, { type: "reach_rate_scan" }, { type: "substrateGap", limit: 2 }]);
    expect(posts).toEqual([]);
  });

  test("must-fail: entries are drawn in the view's order, titled by the view, and the view in force is named", async () => {
    const el = await mount({ view: view([
      { pointer: { type: "record_read", shape: "world_changed" }, form: "rows", title: "What people asked" },
      { pointer: { type: "system_load_report" }, form: "fields" },
    ], 3, { writtenBy: "operator:qa" }) });
    expect(drawn(el)).toEqual(["record_read", "system_load_report"]);
    expect(el.querySelector("[data-report=record_read] h2")!.textContent).toBe("What people asked");
    expect(el.querySelector("[data-report=system_load_report] h2")!.textContent).toBe("system load report");
    const root = el.querySelector(".sf-landing")!;
    expect(root.getAttribute("data-view-id")).toBe("landing@3");
    expect(el.querySelector("[data-view-line]")!.textContent).toBe("Showing view landing@3, written by operator:qa.");
  });

  test("must-fail: a view naming a pointer this build has never seen draws it, with no rebuild", async () => {
    const el = await mount({ view: view([{ pointer: { type: "weather_report" }, form: "fields" }]) });
    expect(el.querySelector("[data-report=weather_report]")!.textContent).toContain("clear");
  });

  test("must-fail: a newer view that was passed over is named with its reason", async () => {
    const el = await mount({ view: view([{ pointer: { type: "system_load_report" }, form: "fields" }], 0, {
      id: "landing@0",
      notDrawn: { id: "landing@2", refusal: "unknown_field", detail: "blocks: a view is {region, entries: [{pointer, form, ...}]}" },
    }) });
    expect(el.querySelector("[data-view-line]")!.textContent).toBe("Showing the default view (landing@0).");
    expect(el.querySelector("[data-view-not-drawn]")!.textContent).toContain("View landing@2 was not drawn: unknown field (blocks:");
  });

  test("must-fail: show draws the last n rows as the producer ordered them, and says how many there were", async () => {
    const el = await mount({ view: view([{ pointer: { type: "record_read", shape: "world_changed" }, form: "rows", show: 2 }]) });
    const rows = [...el.querySelectorAll("[data-report=record_read] [data-row]")].map((r) => r.getAttribute("data-row"));
    expect(rows).toEqual(["w4", "w5"]);
    expect(el.textContent).toContain("the last 2 of 5");
  });

  test("questions: a field's rows are drawn as questions; selecting one opens it and sends nothing", async () => {
    const calls: string[] = [];
    const el = await mount({ view: view([{ pointer: { type: "uiQuestion", open: true }, form: "questions", field: "questions", title: "Waiting on you" }]) }, calls);
    const buttons = el.querySelectorAll("[data-report=uiQuestion] button");
    expect(buttons.length).toBe(3);
    expect(buttons[0]!.textContent).toContain("Reach gap docs align tick");
    await act(async () => (buttons[0] as HTMLButtonElement).click());
    expect(calls).toEqual(["question:q1"]);
    expect(posts.filter((u) => !u.includes("/api/observations"))).toEqual([]);
  });

  test("an entry naming a field the answer lacks says so", async () => {
    const el = await mount({ view: view([{ pointer: { type: "system_load_report" }, form: "rows", field: "rows" }]) });
    expect(el.querySelector("[data-report=system_load_report]")!.textContent).toContain("the answer has no rows");
  });
});
