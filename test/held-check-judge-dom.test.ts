/**
 * The landing lists the detectors' gap rows as "Checks held for you". A held gap carries a `claim`
 * (what the person is asked to judge), and that claim is the row's words; Right or Wrong on it is
 * an outcome row citing exactly that gap row, which the hold lift reads (r 1: the test is right,
 * fix the source; r 0: the test is wrong). A gap row with no claim (an older row of the same gap,
 * a closed one, another kind of gap) has nothing to judge and offers no verdict. The read is
 * every gap row; the newest three are drawn, the rest counted as earlier.
 *
 * Shape: one node 11-11. A failing-test gap was held for a person, and nothing on the surface
 * showed it or let them answer; the hold could only be lifted by an operator's hand.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://surface.test/" });

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { teardownDom, trackRoot } from "./setup.ts";
import { DEFAULT_VIEWS } from "../src/ui-views.ts";

const CLAIM = "The test is right: the source must change so these tests in repos/test-vessel/test/a.test.ts pass: adds ; subtracts";
const gap = (seq: number, id: string, extra: Record<string, unknown>) => ({ input_refs: [], shape: "gap", gap_id: "gap-test-a", category: "failing_test", status: "open", summary: "2 tests fail in test-vessel", meta: { operator_hold: true }, seq, t: "2026-11-11T20:00:00.000Z", writer: "pull-sync", role: "detector", id, ...extra });
const OLDER = gap(10, "gap-row-older", {});
const HELD = gap(20, "gap-row-held", { claim: CLAIM });
const CLOSED = gap(30, "gap-row-closed", { gap_id: "gap-test-b", status: "closed", meta: {} });

const sent: Record<string, unknown>[] = [];
let GAPS: unknown[] = [OLDER, HELD, CLOSED];
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.endsWith("/api/session")) return Response.json({ available: false, keySignIn: true, signedIn: true, person: { userId: "key__test-person", name: null, email: null, expiresAt: Date.now() + 900_000 } });
  if (url.includes("/api/discovery/resolve")) {
    const pointer = JSON.parse(String(init?.body)).pointer as Record<string, unknown>;
    sent.push(pointer);
    if (pointer["type"] === "record_read" && pointer["shape"] === "gap") return Response.json(GAPS);
    if (pointer["type"] === "record_read") return Response.json([]);
    if (pointer["type"] === "record_write") return Response.json({ ok: true, seq: 40 });
  }
  return Response.json({});
}) as typeof fetch;

const uiSrc = new URL("../ui/src/", import.meta.url).pathname;
const React = await import(Bun.resolveSync("react", uiSrc));
const { createRoot: rawCreateRoot } = await import(Bun.resolveSync("react-dom/client", uiSrc));
const createRoot = (...a: Parameters<typeof rawCreateRoot>) => trackRoot(rawCreateRoot(...a));
const { act } = React;
const { QueryClient, QueryClientProvider } = await import(Bun.resolveSync("@tanstack/react-query", uiSrc));
const { Entries } = await import("../ui/src/components/Reports");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterAll(async () => {
  await teardownDom();
});
beforeEach(() => {
  sent.length = 0;
  GAPS = [OLDER, HELD, CLOSED];
});
const settle = async () => {
  for (let i = 0; i < 4; i++) await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
};
const held = DEFAULT_VIEWS.landing.entries.find((e) => e.title === "Checks held for you");

async function mount(): Promise<HTMLElement> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    createRoot(el).render(React.createElement(QueryClientProvider, { client: qc }, React.createElement(Entries, { entries: [held] as never, enabled: true, intervalMs: 60_000, onOpenQuestion: () => {} })));
  });
  await settle();
  return el;
}
const row = (el: HTMLElement, id: string): Element => el.querySelector(`.sf-row[data-row="${id}"]`)!;
const button = (el: Element, text: string) => [...el.querySelectorAll("button")].find((b) => b.textContent === text) as HTMLButtonElement;

describe("checks held for a person", () => {
  test("must-fail: the landing reads the detectors' gap rows, and a held row's claim is the words judged", async () => {
    expect(held?.pointer).toEqual({ type: "record_read", shape: "gap" });
    const el = await mount();
    const h = row(el, HELD.id);
    expect(h.querySelector(".sf-row-words")!.textContent).toContain(CLAIM);
    expect(h.querySelector(".sf-row-judge")).not.toBeNull();
  });

  test("must-fail: a gap row with no claim offers nothing to judge", async () => {
    const el = await mount();
    expect(row(el, OLDER.id).querySelector(".sf-row-judge")).toBeNull();
    expect(row(el, CLOSED.id).querySelector(".sf-row-judge")).toBeNull();
    expect(el.querySelectorAll(".sf-row-judge").length).toBe(1);
  });

  test("the newest three gap rows are drawn, the rest counted as earlier", async () => {
    GAPS = [gap(1, "gap-row-1", {}), gap(2, "gap-row-2", {}), OLDER, HELD, CLOSED];
    const el = await mount();
    expect([...el.querySelectorAll(".sf-rows > .sf-row")].map((r) => r.getAttribute("data-row"))).toEqual([CLOSED.id, HELD.id, OLDER.id]);
    expect(el.querySelector("details.sf-earlier > summary")!.textContent).toBe("2 earlier");
  });

  test("must-fail: Right and Wrong are outcome rows citing exactly the held row", async () => {
    const el = await mount();
    await act(async () => button(row(el, HELD.id), "Right").click());
    await settle();
    await act(async () => button(row(el, HELD.id), "Wrong").click());
    await settle();
    expect(sent.filter((p) => p["type"] === "record_write")).toEqual([
      { type: "record_write", row: { shape: "outcome", r: 1, input_refs: [HELD.id] } },
      { type: "record_write", row: { shape: "outcome", r: 0, input_refs: [HELD.id] } },
    ]);
  });
});
