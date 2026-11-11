/**
 * The default landing is per job (surface-acts-on-shapes-present R.5): what waits on the person,
 * then their asks newest first with their answers, then one line of health, then the raw reads
 * folded and counted. Nothing writes the `health` shape yet, so the line says so; it assembles
 * nothing from the raw reads.
 *
 * Shapes: one node 11-11. The landing drew five open columns of equal weight; the person's latest
 * ask was the last of ten, and "What failed" drew ten bare rows of 1177 beside it.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://surface.test/" });

import { afterAll, describe, expect, test } from "bun:test";
import { teardownDom, trackRoot } from "./setup.ts";
import { DEFAULT_VIEWS } from "../src/ui-views.ts";

const hex = (c: string): string => c.repeat(64);
const ask = (n: number) => ({ input_refs: [], shape: "world_changed", what: `Ask ${n}.`, seq: n, t: `2026-11-0${n}T10:00:00.000Z`, writer: "key_person_1", role: "person", id: hex(String(n)) });
const ASKS = [1, 2, 3, 4, 5, 6, 7].map(ask);
const answerTo = (n: number) => ({ input_refs: [hex(String(n))], text: `Answer to ${n}.`, shape: "answer", seq: 20 + n, t: "2026-11-11T11:56:00.000Z", writer: "described-shape-vessel", role: "described", id: hex(String.fromCharCode(96 + n)) });
const ANSWERS = [6, 7].map(answerTo);
const FAILURES = Array.from({ length: 12 }, (_, i) => ({ input_refs: [], shape: "failure", body: `step ${i} failed`, seq: 40 + i, t: "2026-11-11T12:00:00.000Z", writer: "walk-vessel", role: "walk", id: `f${i}`.padEnd(64, "0") }));
const BY_SHAPE: Record<string, unknown[]> = { world_changed: ASKS, answer: ANSWERS, failure: FAILURES, outcome: [], health: [] };

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.includes("/api/questions")) return Response.json({ resolved: true, success: true, body: { questions: [] } });
  if (url.includes("/api/discovery/resolve")) {
    const pointer = JSON.parse(String(init?.body)).pointer as Record<string, unknown>;
    if (pointer["type"] === "uiQuestion") return Response.json({ resolved: true, success: true, body: { questions: [], empty_reason: "None. 3 open questions name no reader this node serves." } });
    if (pointer["type"] !== "record_read") return Response.json({});
    const rows = (BY_SHAPE[String(pointer["shape"])] ?? []) as { input_refs: string[] }[];
    return Response.json(pointer["refs_to"] === undefined ? rows : rows.filter((r) => r.input_refs.includes(String(pointer["refs_to"]))));
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
const { Entries } = await import("../ui/src/components/Reports");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterAll(async () => {
  await teardownDom();
});
const settle = async () => {
  for (let i = 0; i < 8; i++) await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
};
async function mount(): Promise<HTMLElement> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const entries = React.createElement(Entries, { entries: DEFAULT_VIEWS.landing.entries, enabled: true, intervalMs: 60_000, onOpenQuestion: () => {} });
  await act(async () => {
    createRoot(el).render(React.createElement(QueryClientProvider, { client: qc }, React.createElement(LiveControlsProvider, null, React.createElement(QuestionsProvider, null, entries))));
  });
  await settle();
  return el;
}
const reports = (el: HTMLElement): Element[] => [...el.querySelector(".sf-reports")!.children];

describe("the default landing is per job", () => {
  test("must-fail: needs-you, then the asks, then the health line, then the raw reads folded and counted", async () => {
    const el = await mount();
    const r = reports(el);
    expect(r.map((s) => s.getAttribute("aria-label"))).toEqual(["Waiting on you", "What people asked", "How the system is doing", "What the walk answered", "What failed", "Verdicts and outcomes"]);
    expect(r.map((s) => s.tagName)).toEqual(["SECTION", "SECTION", "SECTION", "DETAILS", "DETAILS", "DETAILS"]);
    expect(r.slice(3).map((d) => d.hasAttribute("open"))).toEqual([false, false, false]);
    expect(r.slice(3).map((d) => d.querySelector("[data-count]")?.getAttribute("data-count"))).toEqual(["2", "12", "0"]);
  });

  test("must-fail: the asks are newest first, each with its answer under it", async () => {
    const el = await mount();
    const asked = reports(el)[1]!;
    const top = [...asked.querySelectorAll(".sf-rows > .sf-row")].filter((r) => !r.parentElement!.closest(".sf-thread")).map((r) => r.getAttribute("data-row"));
    expect(top).toEqual([hex("7"), hex("6"), hex("5"), hex("4"), hex("3")]);
    expect([...asked.querySelectorAll("details.sf-earlier")].filter((d) => !d.closest(".sf-thread")).map((d) => d.querySelector("summary")!.textContent)).toEqual(["2 earlier"]);
    expect(asked.querySelector(`.sf-thread[data-thread-of="${hex("7")}"]`)!.textContent).toContain("Answer to 7.");
  });

  test("must-fail: the health line says nothing reports health, and assembles nothing from the raw reads", async () => {
    const el = await mount();
    const health = reports(el)[2]!;
    expect(health.textContent).toBe("How the system is doingNothing reports health yet.");
  });
});
