/**
 * A view may draw the rows it keeps newest first (surface-acts-on-shapes-present R.5). Records
 * answers oldest first and serves no order argument, so `newest: true` is the view's declared
 * reversal of the producer's order: `show` still keeps the producer's last n, and those n are
 * drawn in reverse. The page sorts by no field of its own.
 *
 * Shapes: one node 11-11. "What people asked" drew asks oldest first, so the person's latest ask
 * was the last of ten, about 6000px down the page at phone width.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://surface.test/" });

import { afterAll, describe, expect, test } from "bun:test";
import { teardownDom, trackRoot } from "./setup.ts";

const hex = (c: string): string => c.repeat(64);
const ask = (n: number) => ({ input_refs: [], shape: "world_changed", what: `Ask ${n}.`, seq: n, t: `2026-11-1${n}T10:00:00.000Z`, writer: "key_person_1", role: "person", id: hex(String(n)) });
// Oldest first, as records answers.
const ASKS = [1, 2, 3, 4, 5].map(ask);
const answer = (n: number) => ({ input_refs: [ASKS[4]!.id], text: `Answer ${n}.`, shape: "answer", seq: 10 + n, t: "2026-11-11T11:56:00.000Z", writer: "described-shape-vessel", role: "described", id: hex(String.fromCharCode(96 + n)) });
const ANSWERS = [1, 2, 3].map(answer);

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.includes("/api/discovery/resolve")) {
    const pointer = JSON.parse(String(init?.body)).pointer as Record<string, unknown>;
    if (pointer["type"] !== "record_read") return Response.json({});
    if (pointer["shape"] === "answer") return Response.json(ANSWERS.filter((r) => r.input_refs.includes(String(pointer["refs_to"]))));
    return Response.json(ASKS);
  }
  return Response.json({});
}) as typeof fetch;

const uiSrc = new URL("../ui/src/", import.meta.url).pathname;
const React = await import(Bun.resolveSync("react", uiSrc));
const { createRoot: rawCreateRoot } = await import(Bun.resolveSync("react-dom/client", uiSrc));
const createRoot = (...a: Parameters<typeof rawCreateRoot>) => trackRoot(rawCreateRoot(...a));
const { act } = React;
const { QueryClient, QueryClientProvider } = await import(Bun.resolveSync("@tanstack/react-query", uiSrc));
const { Entries, rowsOf } = await import("../ui/src/components/Reports");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterAll(async () => {
  await teardownDom();
});
const settle = async () => {
  for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
};
async function mount(entries: unknown[]): Promise<HTMLElement> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    createRoot(el).render(React.createElement(QueryClientProvider, { client: qc }, React.createElement(Entries, { entries: entries as never, enabled: true, intervalMs: 60_000, onOpenQuestion: () => {} })));
  });
  await settle();
  return el;
}
const top = (el: HTMLElement): string[] => [...el.querySelectorAll(".sf-report > .sf-row, .sf-report .sf-rows > .sf-row")].filter((r) => !r.closest(".sf-thread")).map((r) => r.getAttribute("data-row")!);
const asks = { pointer: { type: "record_read", shape: "world_changed" }, form: "rows", show: 3, words: ["what"] };

describe("newest first is the view's declared reversal of the producer's order", () => {
  test("must-fail: show keeps the producer's last n, and newest draws those n in reverse", async () => {
    const el = await mount([{ ...asks, newest: true }]);
    expect(top(el)).toEqual([hex("5"), hex("4"), hex("3")]);
    expect(el.querySelector("details.sf-earlier > summary")!.textContent).toBe("2 earlier");
  });

  test("must-fail: without newest the producer's order stands", async () => {
    const el = await mount([asks]);
    expect(top(el)).toEqual([hex("3"), hex("4"), hex("5")]);
    expect(el.querySelector("details.sf-earlier > summary")!.textContent).toBe("2 earlier");
  });

  test("must-fail: a thread declares its own order", async () => {
    const el = await mount([{ ...asks, show: 1, thread: { pointer: { type: "record_read", refs_to: "$row", shape: "answer" }, form: "rows", show: 2, newest: true, words: ["text"] } }]);
    const thread = el.querySelector(`.sf-thread[data-thread-of="${hex("5")}"]`)!;
    expect([...thread.querySelectorAll(".sf-row")].map((r) => r.getAttribute("data-row"))).toEqual([hex("c"), hex("b")]);
  });

  test("must-fail: the producer's rows are not reordered in place", () => {
    const rows = [...ASKS];
    expect(rowsOf(rows, { show: 2, newest: true })).toMatchObject({ total: 5 });
    expect(rowsOf(rows, { newest: true })).toMatchObject({ total: 5 });
    expect(rows.map((r) => r.seq)).toEqual([1, 2, 3, 4, 5]);
  });
});
