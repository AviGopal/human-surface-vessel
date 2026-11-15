/**
 * A listed ask offers "about this" where its view declares `about`. The control only chooses what
 * the one box is about (interface-as-shapes design.md §5): the chip says the next message is a new
 * ask about that one, which starts fresh, and the box stays the one input. Sent, the ask is the
 * same world_changed row an ask is, citing the ask and the answer drawn under it, and no `r`: a row
 * with one that cites rows is a verdict to records (store.ts verdict), and would close or debit
 * them. Nothing reads a follow-up yet, so the page never calls it one.
 *
 * Shape: the USER 11-15, "We need to be able to continue from a walk". A person's row citing an
 * earlier ask is a new root to records, whose episode is only itself; carrying the earlier work
 * into it is records' gap, not the page's.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://surface.test/" });

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { teardownDom, trackRoot } from "./setup.ts";
import { DEFAULT_VIEWS, resetViewsForTest, writeView } from "../src/ui-views.ts";

const ASK = { input_refs: [], shape: "world_changed", what: "Why did the last two landings on local-tools fail?", seq: 10, t: "2026-11-15T03:00:00.000Z", role: "person", id: "a".repeat(64) };
const OLD = { input_refs: [ASK.id], shape: "answer", text: "Looking into it.", seq: 12, t: "2026-11-15T03:05:00.000Z", role: "described", id: "b".repeat(64) };
const NEW = { input_refs: [ASK.id], shape: "answer", text: "Both failed the typecheck.", seq: 14, t: "2026-11-15T03:10:00.000Z", role: "described", id: "c".repeat(64) };
const STRAY = { input_refs: ["e".repeat(64)], shape: "answer", text: "About something else.", seq: 15, t: "2026-11-15T03:20:00.000Z", role: "described", id: "d".repeat(64) };

let answers: Record<string, unknown>[] = [];
let signedIn = true;
const written: string[] = [];
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  const person = { userId: "key_person_1", name: null, email: null, expiresAt: Date.now() + 900_000 };
  if (url.endsWith("/api/session")) return Response.json({ keySignIn: true, signedIn, person: signedIn ? person : null });
  if (url.includes("/api/discovery/resolve")) {
    const raw = String(init?.body);
    const pointer = JSON.parse(raw).pointer as Record<string, unknown>;
    if (pointer["type"] === "record_write") {
      written.push(raw);
      if (!signedIn) return Response.json({ error: "sign_in_required", reason: "sign in" }, { status: 401 });
      return Response.json({ resolved: true, success: true, body: { ...(pointer["row"] as object), seq: 20 + written.length, id: "f".repeat(64) } });
    }
    if (pointer["type"] !== "record_read") return Response.json({});
    if (pointer["shape"] === "world_changed") return Response.json([ASK]);
    if (pointer["shape"] === "answer" && pointer["refs_to"] === ASK.id) return Response.json(answers);
    return Response.json([]);
  }
  if (url.includes("/api/questions")) return Response.json({ resolved: true, success: true, body: { questions: [] } });
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
const { TopBar } = await import("../ui/src/components/TopBar");
const { Entries } = await import("../ui/src/components/Reports");
const { boxContext } = await import("../ui/src/lib/box");
const { useAskAbout } = await import("../ui/src/state/askAbout");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterAll(async () => {
  await teardownDom();
});
beforeEach(() => {
  answers = [OLD, NEW];
  signedIn = true;
  written.length = 0;
  document.body.replaceChildren();
});
const settle = async () => {
  for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
};

const thread = { pointer: { type: "record_read", refs_to: "$row", shape: "answer" }, form: "rows", show: 1, newest: true, words: ["text"], judge: "outcome" };
const asks = (about: boolean) => ({ pointer: { type: "record_read", shape: "world_changed" }, form: "rows", words: ["what"], thread, ...(about ? { about: true } : {}) });

/** The box and the listed asks, wired as the surface wires them (Surface.tsx). */
function Page({ entries }: { entries: unknown[] }) {
  const [about, clearAbout] = useAskAbout();
  const context = boxContext(null, null, null, about);
  return React.createElement(
    React.Fragment,
    null,
    React.createElement(TopBar, { context, onSetAside: clearAbout, onAsked: clearAbout, openIssues: null, onToggleIssues: () => {}, issuesOpen: false }),
    React.createElement(Entries, { entries, enabled: true, intervalMs: 60_000, onOpenQuestion: () => {} }),
  );
}
async function mount(entries: unknown[]): Promise<HTMLElement> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    createRoot(el).render(React.createElement(QueryClientProvider, { client: qc }, React.createElement(LiveControlsProvider, null, React.createElement(QuestionsProvider, null, React.createElement(Page, { entries })))));
  });
  await settle();
  return el;
}
const chip = (el: HTMLElement) => el.querySelector(".sf-box-chip")!.textContent ?? "";
async function aboutThis(el: HTMLElement) {
  const b = el.querySelector(`.sf-row[data-row="${ASK.id}"] .sf-row-about`) as HTMLButtonElement;
  await act(async () => { b.click(); });
  await settle();
}
async function send(el: HTMLElement, text: string) {
  const box = el.querySelector("textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!.call(box, text);
    box.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => { box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
  await settle();
}
const rowOf = (raw: string) => (JSON.parse(raw).pointer as { row: Record<string, unknown> }).row;

describe("a new ask about a listed one", () => {
  test("must-fail: the ask cites the ask and the answer drawn under it, and has no r at all", async () => {
    const el = await mount([asks(true)]);
    await aboutThis(el);
    expect(written).toEqual([]);
    await send(el, "Which file was it?");
    expect(written).toHaveLength(1);
    const row = rowOf(written[0]!);
    expect(row).toEqual({ shape: "world_changed", what: "Which file was it?", input_refs: [ASK.id, NEW.id] });
    expect(Object.keys(row)).not.toContain("r");
    expect(written[0]).not.toContain('"r"');
  });

  test("must-fail: only an answer the view drew, and only one citing this ask, is cited", async () => {
    // The thread draws its newest row only: here one that cites another ask. OLD and NEW were not drawn.
    answers = [OLD, NEW, STRAY];
    const el = await mount([asks(true)]);
    await aboutThis(el);
    await send(el, "And now?");
    expect(rowOf(written[0]!)["input_refs"]).toEqual([ASK.id]);
  });

  test("must-fail: the chip says it is a new ask about that one, which starts fresh, never a follow-up", async () => {
    const el = await mount([asks(true)]);
    expect(chip(el)).toBe("New ask");
    await aboutThis(el);
    expect(chip(el)).toContain(`New ask about “${ASK.what}”`);
    expect(el.querySelector(".sf-box-chip .sf-box-chip-words")!.textContent).toBe(ASK.what);
    expect(chip(el)).toContain("starts fresh");
    expect(el.textContent!.toLowerCase()).not.toContain("follow-up");
    expect(el.querySelector(".sf-box-chip")!.getAttribute("title")).toBe(ASK.what);
  });

  test("must-fail: once stored, the box is a new ask again and the next ask cites nothing", async () => {
    const el = await mount([asks(true)]);
    await aboutThis(el);
    await send(el, "Which file was it?");
    expect(chip(el)).toBe("New ask");
    expect(el.querySelector(".sf-visually-hidden[role='status']")!.textContent).toContain("the walk starts it fresh");
    await send(el, "Something else.");
    expect(rowOf(written[1]!)["input_refs"]).toEqual([]);
  });

  test("must-fail: × sets it aside, and the next ask cites nothing", async () => {
    const el = await mount([asks(true)]);
    await aboutThis(el);
    const x = el.querySelector(".sf-box-chip button") as HTMLButtonElement;
    await act(async () => { x.click(); });
    await settle();
    expect(chip(el)).toBe("New ask");
    await send(el, "Hello");
    expect(rowOf(written[0]!)["input_refs"]).toEqual([]);
  });

  test("must-fail: signed out, nothing is stored and what it was about stays, with the words", async () => {
    signedIn = false;
    const el = await mount([asks(true)]);
    await aboutThis(el);
    await send(el, "Which file was it?");
    expect(chip(el)).toContain("starts fresh");
    expect(el.querySelector("textarea")!.value).toBe("Which file was it?");
  });

  test("control: a view that does not declare it offers no control", async () => {
    const el = await mount([asks(false)]);
    expect(el.querySelector(`.sf-row[data-row="${ASK.id}"]`)).not.toBeNull();
    expect(el.querySelector(".sf-row-about")).toBeNull();
  });
});

describe("the view contract", () => {
  test("must-fail: about is true, on rows, and never in a thread", () => {
    const pointer = { type: "record_read", shape: "world_changed" };
    for (const entry of [
      { pointer, form: "rows", about: false },
      { pointer, form: "fields", about: true },
      { pointer, form: "rows", thread: { ...thread, about: true } },
    ]) {
      const w = writeView({ region: "landing", entries: [entry] }, null);
      expect(w.ok).toBe(false);
      expect(w.ok ? "" : w.detail).toContain("about");
    }
    // The field is known: on a listed row it is taken (refused above only where it does not belong).
    const taken = writeView({ region: "landing", entries: [{ pointer, form: "rows", about: true }] }, null);
    resetViewsForTest();
    expect(taken.ok).toBe(true);
  });

  test("the default view's asks declare it, so the field has a reader from the start", () => {
    const listed = DEFAULT_VIEWS.landing.entries.find((e) => e.title === "What people asked");
    expect(listed?.about).toBe(true);
  });
});
