/**
 * The ask is the unit (surface-acts-on-shapes-present R.4): under each ask the view's thread
 * shows its newest reply, and what a view's `show` cuts is folded under a count rather than
 * dropped, neither drawn nor read until it is opened. An ask's words read above its replies:
 * the weight is the view's, given to rows of an entry that declares a thread.
 *
 * Shape: one node 11-11. "How do you start a new container?" drew three replies, each with its
 * own time, details and verdict, so two asks filled the screen; the USER: "The height is taken
 * by the walk."
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://surface.test/" });

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { teardownDom, trackRoot } from "./setup.ts";
import { DEFAULT_VIEWS } from "../src/ui-views.ts";

const hex = (c: string): string => c.repeat(64);
const ask = (c: string, what: string, seq: number) => ({ input_refs: [], shape: "world_changed", what, seq, t: `2026-11-11T1${seq % 10}:00:00.000Z`, writer: "key_person_1", role: "person", id: hex(c) });
// Oldest first, as records returns them: THREE has three replies, ONE has one, NONE has none, OLD is cut by the asks' own show.
const OLD = ask("0", "An old ask.", 1);
const NONE = ask("e", "Where are we?", 2);
const ONE = ask("f", "Hello", 3);
const THREE = ask("a", "How do you start a new container?", 4);
const reply = (n: number, to: string) => ({ input_refs: [to], text: `Reply ${n}.`, shape: "answer", seq: 20 + n, t: `2026-11-11T12:0${n}:00.000Z`, writer: "described-shape-vessel", role: "described", id: String(n).repeat(64) });
const ALL = [OLD, NONE, ONE, THREE, reply(1, THREE.id), reply(2, THREE.id), reply(3, THREE.id), reply(4, ONE.id), reply(5, OLD.id)];

const sent: Record<string, unknown>[] = [];
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.endsWith("/api/session")) return Response.json({ available: false, keySignIn: true, signedIn: true, person: { userId: "key_person_1", name: null, email: null, expiresAt: Date.now() + 900_000 } });
  if (url.includes("/api/discovery/resolve")) {
    const pointer = JSON.parse(String(init?.body)).pointer as Record<string, unknown>;
    sent.push(pointer);
    if (pointer["type"] !== "record_read") return Response.json({});
    // records' read: shape and refs_to (input_refs) compose; rows oldest first.
    return Response.json(ALL.filter((r) => (pointer["shape"] === undefined || r.shape === pointer["shape"]) && (pointer["refs_to"] === undefined || r.input_refs.includes(String(pointer["refs_to"])))));
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
function inView(node: Element): string {
  const copy = node.cloneNode(true) as Element;
  copy.querySelectorAll("details:not([open]) > :not(summary)").forEach((n) => n.remove());
  return copy.textContent ?? "";
}
const asked = DEFAULT_VIEWS.landing.entries.find((e) => e.title === "What people asked")!;
const view = { ...asked, show: 3 };
const row = (el: Element, id: string): Element => el.querySelector(`.sf-row[data-row="${id}"]`)!;
const threadOf = (el: Element, id: string): Element => [...row(el, id).children].find((c) => c.matches(".sf-thread"))!;
const own = (thread: Element): Element[] => [...thread.querySelectorAll(".sf-row")].filter((r) => !r.closest(".sf-earlier"));
async function toggle(d: HTMLDetailsElement, open: boolean): Promise<void> {
  await act(async () => {
    d.open = open;
    d.dispatchEvent(new Event("toggle"));
  });
  await settle();
}

describe("the ask is the unit", () => {
  test("must-fail: the default thread shows the newest reply; the rest are one closed fold that says how many", async () => {
    const el = await mount([asked]);
    const t = threadOf(el, THREE.id);
    expect(own(t).map((r) => r.getAttribute("data-row"))).toEqual(["3".repeat(64)]);
    const folds = [...t.querySelectorAll("details.sf-earlier")] as HTMLDetailsElement[];
    expect(folds.length).toBe(1);
    expect(folds[0]!.open).toBe(false);
    expect(folds[0]!.querySelector("summary")!.textContent).toBe("2 earlier");
    expect(folds[0]!.querySelectorAll(".sf-row").length).toBe(0);
  });

  test("must-fail: what a fold holds is not read until it is opened, then drawn newest first", async () => {
    const el = await mount([view]);
    expect(sent.some((p) => p["refs_to"] === OLD.id)).toBe(false);
    const fold = [...el.querySelectorAll("details.sf-earlier")].find((d) => !d.closest(".sf-thread")) as HTMLDetailsElement;
    expect(fold.querySelector("summary")!.textContent).toBe("1 earlier");
    await toggle(fold, true);
    expect(sent.some((p) => p["refs_to"] === OLD.id)).toBe(true);
    expect(row(fold, OLD.id)).not.toBeNull();
    const t = threadOf(el, THREE.id).querySelector("details.sf-earlier") as HTMLDetailsElement;
    await toggle(t, true);
    expect([...t.querySelectorAll(".sf-row")].map((r) => r.getAttribute("data-row"))).toEqual(["2".repeat(64), "1".repeat(64)]);
  });

  test("must-fail: an ask's words carry the parent weight, and no reply's do", async () => {
    const el = await mount([asked]);
    expect(row(el, THREE.id).classList.contains("sf-row-parent")).toBe(true);
    const replies = [...el.querySelectorAll(".sf-thread .sf-row")];
    expect(replies.length).toBeGreaterThan(0);
    expect(replies.filter((r) => r.classList.contains("sf-row-parent"))).toEqual([]);
  });

  test("control: an ask with one reply has no fold; an ask with none says so", async () => {
    const el = await mount([asked]);
    expect(threadOf(el, ONE.id).querySelector("details.sf-earlier")).toBeNull();
    expect(own(threadOf(el, ONE.id)).length).toBe(1);
    expect(threadOf(el, NONE.id).textContent).toContain("Not answered yet.");
    expect(threadOf(el, NONE.id).querySelector("details.sf-earlier")).toBeNull();
  });

  test("control: closing an opened fold reads nothing new", async () => {
    const el = await mount([view]);
    const fold = [...el.querySelectorAll("details.sf-earlier")].find((d) => !d.closest(".sf-thread")) as HTMLDetailsElement;
    await toggle(fold, true);
    const after = sent.length;
    await toggle(fold, false);
    expect(sent.length).toBe(after);
  });
});
