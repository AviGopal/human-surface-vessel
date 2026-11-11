/**
 * A folded read declared with `strip: {hours}` draws, in its summary, one bar per hour of the last
 * `hours`, each as tall as the rows read whose `t` falls in it, on that strip's own scale, with the
 * window named in words beside it. It is drawn from the rows the read returned, never a second
 * read; rows older than the window count but are not drawn. A read cut to its newest rows that does
 * not reach back to the window's start says so instead of looking whole.
 *
 * Shapes: one node 11-11. The landing's three folded reads were bare counts (111, 1637, 256); the
 * person asked twice for "a little graph or visual of some kind with shapes and colors".
 */
process.env.TZ = "UTC";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://surface.test/" });

import { afterAll, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import { forgetViews, teardownDom, testAuth, trackRoot } from "./setup.ts";
import { DEFAULT_VIEWS } from "../src/ui-views.ts";
import { impulsesRouter } from "../src/routes/impulses.ts";

const NOW = Date.parse("2026-11-11T16:30:00.000Z");
const H = 3_600_000;
const failure = (i: number, msAgo: number) => ({ input_refs: [], shape: "failure", body: `step ${i} failed`, seq: 100 + i, t: new Date(NOW - msAgo).toISOString(), writer: "walk-vessel", role: "walk", id: `f${i}`.padEnd(64, "0") });
// Oldest first, as records answers: 2 rows two days ago, 1 at 17:00 yesterday (the window's first hour), 4 at 13:00, 2 in the current hour (16:00).
const SPREAD = [failure(0, 48 * H), failure(1, 47 * H), failure(2, 23.5 * H), ...[3, 4, 5, 6].map((i) => failure(i, 3.5 * H)), failure(7, 10 * 60_000), failure(8, 5 * 60_000)];
let ROWS: unknown[] = SPREAD;
const reads: Record<string, unknown>[] = [];

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.includes("/api/discovery/resolve")) {
    const pointer = JSON.parse(String(init?.body)).pointer as Record<string, unknown>;
    reads.push(pointer);
    if (pointer["type"] === "record_read" && pointer["shape"] === "failure") return Response.json(ROWS);
    if (pointer["type"] === "record_read") return Response.json([]);
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
  setSystemTime();
  forgetViews();
  await teardownDom();
});
beforeEach(() => {
  setSystemTime(new Date(NOW));
  ROWS = SPREAD;
  reads.length = 0;
});
const settle = async () => {
  for (let i = 0; i < 4; i++) await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
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
const failed = DEFAULT_VIEWS.landing.entries.find((e) => e.title === "What failed")!;
const summary = (el: HTMLElement): Element => el.querySelector('[aria-label="What failed"] > summary')!;
const bars = (el: HTMLElement): HTMLElement[] => [...summary(el).querySelectorAll(".sf-strip-bar")] as HTMLElement[];
/** A bar's height as a share of its strip, and whether it is held off flat. */
const pct = (b: HTMLElement): number => Number(b.style.height.replace("%", ""));
const floor = (b: HTMLElement): boolean => b.style.minHeight === "1px";

async function writeView(entries: unknown[]) {
  const r = await impulsesRouter.request("/v2/impulses/resolve", {
    method: "POST",
    headers: { "content-type": "application/json", ...testAuth() },
    body: JSON.stringify({ pointer: { type: "uiView_write", region: "landing", entries } }),
  });
  return { status: r.status, json: (await r.json()) as any };
}

describe("a folded read draws when its rows came", () => {
  test("must-fail (a): the three default folded reads declare a 24-hour strip", () => {
    const folded = DEFAULT_VIEWS.landing.entries.filter((e) => e.folded);
    expect(folded.map((e) => e.title)).toEqual(["What the walk answered", "What failed", "Verdicts and outcomes"]);
    expect(folded.map((e) => e.strip)).toEqual([{ hours: 24 }, { hours: 24 }, { hours: 24 }]);
  });

  test("must-fail (b): 24 bars, one per hour, on the strip's own scale; a bin with a row is never drawn flat", async () => {
    const el = await mount([failed]);
    const b = bars(el);
    expect(b.length).toBe(24);
    expect(b.map((x) => Number(x.getAttribute("data-n")))).toEqual([1, ...new Array(19).fill(0), 4, 0, 0, 2]);
    expect(Math.max(...b.map(pct))).toBe(100);
    expect(pct(b[20]!)).toBe(100);
    expect(pct(b[23]!)).toBe(50);
    expect(pct(b[0]!)).toBe(25);
    expect(b.filter((x) => x.getAttribute("data-n") === "0").every((x) => pct(x) === 0 && !floor(x))).toBe(true);
    expect(b.filter((x) => x.getAttribute("data-n") !== "0").every(floor)).toBe(true);
    // A single row against a tall bin still shows.
    ROWS = [failure(0, 30 * 60_000), ...Array.from({ length: 40 }, (_, i) => failure(i + 1, 5 * H))];
    const tall = bars(await mount([failed]));
    expect(pct(tall[23]!)).toBe(3);
    expect(floor(tall[23]!)).toBe(true);
    // and the read was the one read the entry already makes
    expect(reads.filter((p) => p["shape"] === "failure").every((p) => Object.keys(p).sort().join() === "shape,type")).toBe(true);
  });

  test("must-fail (c): rows older than the window are not drawn, and still count", async () => {
    const el = await mount([failed]);
    expect(summary(el).querySelector("[data-count]")!.getAttribute("data-count")).toBe("9");
    expect(bars(el).reduce((a, x) => a + Number(x.getAttribute("data-n")), 0)).toBe(7);
  });

  test("must-fail (d): the window is named in words beside the strip; its label is plain, with no id, raw time or shape name", async () => {
    const el = await mount([failed]);
    const strip = summary(el).querySelector(".sf-strip")!;
    expect(strip.getAttribute("aria-label")).toBe("7 in the last 24 hours, most around 1 PM");
    expect(summary(el).querySelector(".sf-strip-caption")!.textContent).toBe("last 24 hours");
    expect(bars(el)[20]!.getAttribute("title")).toBe("1 PM: 4");
    expect(bars(el)[23]!.getAttribute("title")).toBe("4 PM: 2");
    const text = summary(el).textContent! + [...summary(el).querySelectorAll("[title],[aria-label]")].map((n) => `${n.getAttribute("title")} ${n.getAttribute("aria-label")}`).join(" ");
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}T|\bfailure\b|f0{8}|walk-vessel/);
  });

  test("must-fail (e): strip on an open entry, or hours outside 1..168, is refused by name", async () => {
    const asks = DEFAULT_VIEWS.landing.entries.find((e) => e.title === "What people asked")!;
    for (const [entry, said] of [
      [{ ...asks, strip: { hours: 24 } }, "strip needs folded"],
      [{ ...failed, strip: { hours: 0 } }, "strip: {hours: 1..168}"],
      [{ ...failed, strip: { hours: 200 } }, "strip: {hours: 1..168}"],
      [{ ...failed, strip: { hours: 24, by: "r" } }, "strip: {hours: 1..168}"],
    ] as const) {
      const r = await writeView([entry]);
      expect(r.status).toBe(422);
      expect(JSON.stringify(r.json)).toContain(said);
    }
  });

  test("must-fail (f): a read cut to its newest rows that does not reach the window's start says so, not a whole-looking strip", async () => {
    ROWS = Array.from({ length: 3 }, (_, i) => failure(i, (3 - i) * 60_000));
    const el = await mount([{ ...failed, pointer: { ...failed.pointer, last: 3 } }]);
    expect(summary(el).querySelector(".sf-strip")!.getAttribute("aria-label")).toBe("only the latest 3 shown");
    expect(summary(el).querySelector(".sf-strip-caption")!.textContent).toBe("only the latest 3 shown");
    // The same rows from a read that was not cut are drawn as what they are.
    const whole = await mount([failed]);
    expect(summary(whole).querySelector(".sf-strip")!.getAttribute("aria-label")).toBe("3 in the last 24 hours, most around 4 PM");
  });
});

describe("controls", () => {
  test("an entry with no strip draws no strip", async () => {
    const el = await mount([{ ...failed, strip: undefined }]);
    expect(summary(el).querySelector(".sf-strip")).toBeNull();
    expect(summary(el).querySelector("[data-count]")!.getAttribute("data-count")).toBe("9");
  });

  test("an empty window draws the baseline and says none", async () => {
    ROWS = [failure(0, 30 * H)];
    const el = await mount([failed]);
    expect(bars(el).every((x) => pct(x) === 0 && !floor(x))).toBe(true);
    expect(summary(el).querySelector(".sf-strip-caption")!.textContent).toBe("none in the last 24 hours");
  });

  test("the fold still opens to its rows", async () => {
    const el = await mount([failed]);
    const fold = el.querySelector('[aria-label="What failed"]') as HTMLDetailsElement;
    expect(fold.open).toBe(false);
    expect(fold.querySelectorAll(".sf-row").length).toBe(9);
  });
});
