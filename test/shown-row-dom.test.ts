/**
 * What the page shows a signed-in person is written as their records row (src/lib/shown.ts): the rows
 * on screen by id and shape, no citation and no grade, so records reads it as neither their word on a
 * root nor a verdict; signed out, nothing. One row per new set on screen, no sooner than a minute after
 * the last.
 *
 * Shapes: the landing draws records rows as `.sf-row[data-row]`; a person's row reaches records
 * through POST /api/discovery/resolve as {pointer: {type: "record_write", row}}, sent under their
 * key by the server, which stamps nothing of them into the row.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://surface.test/" });

import { afterAll, afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import { teardownDom, trackRoot } from "./setup.ts";
import { currentView, resetViewsForTest } from "../src/ui-views.ts";
import { SHOWN_MIN_MS, ShownGate } from "../ui/src/lib/shown";

const hex = (c: string): string => c.repeat(64);
const at = (seq: number): string => `2026-11-16T09:${String(seq).padStart(2, "0")}:00.000Z`;
const ask = (c: string, seq: number) => ({ input_refs: [], shape: "world_changed", what: `Ask ${c}.`, seq, t: at(seq), writer: "key_person_1", role: "person", id: hex(c) });
const A = ask("a", 1);
const B = ask("b", 2);
const C = ask("c", 3);
const GAP = { input_refs: [], shape: "gap", gap_id: "shell-run-escapes", claim: "A shell run can leave its directory.", status: "open", seq: 4, t: at(4), writer: "detector", role: "detector", id: hex("d") };

let rows: Record<string, unknown>[] = [];
let signedIn = true;
let writeAnswer: () => Response = () => Response.json({ success: true, body: { seq: 9, id: hex("9") } });
const written: Record<string, unknown>[] = [];
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.endsWith("/api/session")) return Response.json(signedIn ? { keySignIn: true, signedIn: true, person: { userId: "key_person_1", name: null, email: null, expiresAt: Date.now() + 900_000 } } : { keySignIn: true, signedIn: false });
  if (url.includes("/api/discovery/resolve")) {
    const p = JSON.parse(String(init?.body)).pointer as Record<string, unknown>;
    if (p["type"] === "record_write") {
      written.push(p["row"] as Record<string, unknown>);
      return writeAnswer();
    }
    if (p["type"] !== "record_read") return Response.json({ success: true, body: { questions: [], total: 0 } });
    return Response.json(rows.filter((o) => p["shape"] === undefined || o["shape"] === p["shape"]));
  }
  return Response.json({});
}) as typeof fetch;

// happy-dom lays nothing out: each row is placed by its order in the page, 40 px tall, 50 px apart,
// in a window 400 px tall, so rows past the eighth are below what the person sees.
const realRect = Element.prototype.getBoundingClientRect;
Element.prototype.getBoundingClientRect = function (this: Element): DOMRect {
  if (!(this as HTMLElement).matches?.(".sf-row[data-row]")) return realRect.call(this);
  const i = [...document.querySelectorAll(".sf-row[data-row]")].indexOf(this);
  const y = i * 50;
  return { x: 0, y, width: 400, height: 40, top: y, left: 0, right: 400, bottom: y + 40, toJSON: () => ({}) } as DOMRect;
};
Object.defineProperty(window, "innerWidth", { value: 400, configurable: true });
Object.defineProperty(window, "innerHeight", { value: 400, configurable: true });

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
  Element.prototype.getBoundingClientRect = realRect;
  await teardownDom();
});
let visibility: DocumentVisibilityState = "visible";
Object.defineProperty(document, "visibilityState", { get: () => visibility, configurable: true });
beforeEach(() => {
  visibility = "visible";
  written.length = 0;
  signedIn = true;
  writeAnswer = () => Response.json({ success: true, body: { seq: 9, id: hex("9") } });
  setSystemTime(new Date("2026-11-18T05:00:00.000Z"));
});
afterEach(() => setSystemTime());

const ENTRIES = [{ pointer: { type: "record_read", shape: "world_changed" }, form: "rows", title: "Asked", words: ["what"] }, { pointer: { type: "record_read", shape: "gap" }, form: "rows", title: "Problems", words: ["claim"] }];
const settle = async (ms = 1_200): Promise<void> => {
  await act(async () => { await new Promise((r) => setTimeout(r, ms)); });
};

// readFirst: the page is drawn while its view is still being read, and the view arrives after.
async function mount(readFirst = false): Promise<HTMLElement> {
  resetViewsForTest();
  const view = { ...currentView("landing"), above: [], revision: 3, id: "landing@3", entries: ENTRIES, isDefault: false, drawsDefault: false };
  const el = document.createElement("div");
  document.body.replaceChildren(el);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const root = createRoot(el);
  const draw = (v: typeof view | null) => root.render(React.createElement(QueryClientProvider, { client: qc },
    React.createElement(LiveControlsProvider, null, React.createElement(QuestionsProvider, null, React.createElement(Landing, { view: v, onOpenQuestion: () => {} } as never)))));
  if (readFirst) {
    await act(async () => { draw(null); });
    for (let i = 0; i < 10; i++) await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  }
  await act(async () => { draw(view); });
  for (let i = 0; i < 10; i++) await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  return el;
}

describe("what the page shows a signed-in person is their records row, citing nothing and grading nothing", () => {
  test("must-fail: the rows on screen are written once the page settles, by id and shape, with no citation, no grade and nothing naming the person", async () => {
    rows = [A, B, GAP];
    await mount();
    await settle();
    expect(written).toHaveLength(1);
    const row = written[0]!;
    expect(row["shape"]).toBe("exposure");
    expect(row["shown"]).toEqual([{ id: A.id, shape: "world_changed" }, { id: B.id, shape: "world_changed" }, { id: GAP.id, shape: "gap" }]);
    expect("input_refs" in row).toBe(false);
    expect("r" in row).toBe(false);
    expect(row["presentation"]).toBe("landing@3");
    expect(JSON.stringify(row)).not.toContain("key_person_1");
  });

  test("must-fail: a page drawn before its view arrives writes what it shows once the view is drawn", async () => {
    rows = [A, B];
    await mount(true);
    await settle();
    expect(written).toHaveLength(1);
  });

  test("must-fail: signed out, nothing is written", async () => {
    signedIn = false;
    rows = [A, B];
    await mount();
    await settle();
    expect(written).toHaveLength(0);
  });

  test("a row below what the person sees is not among what was shown", async () => {
    rows = Array.from({ length: 10 }, (_, i) => ask(String.fromCharCode(0x65 + i), 10 + i));
    await mount();
    await settle();
    expect((written[0]!["shown"] as { id: string }[]).map((s) => s.id)).toEqual(rows.slice(0, 8).map((r) => r["id"]));
  });

  test("the same rows on screen again write nothing more; a new set inside the minute waits for it, then is written", async () => {
    rows = [A, B];
    await mount();
    await settle();
    expect(written).toHaveLength(1);
    await act(async () => { window.dispatchEvent(new Event("scroll")); });
    await settle();
    expect(written).toHaveLength(1);
    rows = [A, B, C];
    await mount();
    await settle();
    // A fresh page: its own first row. The minute is a page's, so a remount writes its first set at once.
    expect(written).toHaveLength(2);
  });

  // A new row put on the page past the minute: one the page has not shown, and one it already shows, drawn twice.
  const later = async (el: HTMLElement, settled: "scroll" | "resize" = "scroll"): Promise<void> => {
    setSystemTime(new Date(Date.now() + SHOWN_MIN_MS + 1_000));
    const list = el.querySelector(".sf-row[data-row]")!.parentElement!;
    await act(async () => {
      for (const [id, shape] of [[A.id, "world_changed"], [hex("e"), "gap"]] as const) {
        const li = document.createElement("li");
        li.className = "sf-row";
        li.setAttribute("data-row", id);
        li.setAttribute("data-shape", shape);
        list.append(li);
      }
      // happy-dom does not tell the page's change watcher (a MutationObserver armed in an effect) of these, as a browser
      // does; a scroll or a resize settles the page the same way. That the page watches for changes is its own leg, below.
      window.dispatchEvent(new Event(settled));
    });
    await settle();
  };

  test.each(["scroll", "resize"] as const)("control: past the minute, a new row on the page is written once it settles after a %s, and a row drawn twice is shown once", async (settled) => {
    rows = [A];
    const el = await mount();
    await settle();
    await later(el, settled);
    expect(written).toHaveLength(2);
    expect(written[1]!["shown"]).toEqual([{ id: A.id, shape: "world_changed" }, { id: hex("e"), shape: "gap" }]);
  });

  test("must-fail: a write refused as signed out stops the page writing", async () => {
    writeAnswer = () => Response.json({ error: "sign_in_required" }, { status: 401 });
    rows = [A];
    const el = await mount();
    await settle();
    expect(written).toHaveLength(1);
    await later(el);
    expect(written).toHaveLength(1);
  });

  test("must-fail: the page watches the whole landing for rows that arrive or change", async () => {
    const Real = globalThis.MutationObserver;
    const watched: { el: Element; opts: MutationObserverInit | undefined }[] = [];
    globalThis.MutationObserver = class extends Real {
      override observe(el: Node, opts?: MutationObserverInit): void {
        watched.push({ el: el as Element, opts });
        super.observe(el, opts);
      }
    };
    try {
      rows = [A];
      await mount();
      await settle();
    } finally {
      globalThis.MutationObserver = Real;
    }
    expect(watched.some((w) => w.el.classList.contains("sf-landing") && w.opts?.childList === true && w.opts?.subtree === true)).toBe(true);
  });

  test("must-fail: a page out of view writes nothing, however its rows change; back in view, it writes what it shows", async () => {
    visibility = "hidden";
    rows = [A];
    const el = await mount();
    await settle();
    await later(el);
    expect(written).toHaveLength(0);
    visibility = "visible";
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    await settle();
    expect(written).toHaveLength(1);
    expect(written[0]!["shown"]).toEqual([{ id: A.id, shape: "world_changed" }, { id: hex("e"), shape: "gap" }]);
  });

  test("a page showing no rows writes nothing", async () => {
    rows = [];
    await mount();
    await settle();
    expect(written).toHaveLength(0);
  });
});

describe("a page writes a new set on screen, and no sooner than a minute after its last row", () => {
  const s = (...ids: string[]) => ids.map((id) => ({ id, shape: "world_changed" }));
  test("must-fail: a set already written is not written again; a new one waits out the minute; past it, it is written", () => {
    const g = new ShownGate();
    const t0 = 1_000_000;
    expect(g.check(s("a"), t0)).toBe("write");
    g.wrote(s("a"), t0);
    expect(g.check(s("a"), t0 + 5 * SHOWN_MIN_MS)).toBe("same");
    expect(g.check(s("a", "b"), t0 + 10_000)).toBe(SHOWN_MIN_MS - 10_000);
    expect(g.check(s("b", "a"), t0 + SHOWN_MIN_MS)).toBe("write");
  });

  test("control: the minute is a cap, not a delay: the first set is written at once", () => {
    expect(new ShownGate().check(s("a"), 0)).toBe("write");
  });
});
