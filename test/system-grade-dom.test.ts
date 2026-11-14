/**
 * The system's own grade of a row is drawn only after this person's verdict on it, so it cannot
 * anchor the verdict (surface-acts-on-shapes-present R.7). Which grades are the system's is the
 * view's declared read (`graded`, a records read `where` the grade's role is the walk's), never a
 * partition in the page; records stamps `role` from the writer's key. It is drawn closed, under
 * "the system's own grade", apart from Right and Wrong.
 *
 * Shapes: one node 11-11. The walk graded its own answer to "What is happening in the world
 * today?" r 0 (outcome a466cb53, role described); the page offered the person Right and Wrong on
 * that answer with nothing to say the system had already judged it wrong.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://surface.test/" });

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { teardownDom, trackRoot } from "./setup.ts";
import { DEFAULT_VIEWS } from "../src/ui-views.ts";

const ANSWER = { input_refs: ["d14cd850"], text: "What would you like to narrow it to?", shape: "answer", seq: 5411, t: "2026-11-11T13:34:30.000Z", writer: "described-shape-vessel", role: "described", id: "d0097dae" };
const SYSTEM = { input_refs: ["d14cd850", "d0097dae"], r: 0, shape: "outcome", seq: 5415, t: "2026-11-11T13:34:36.023Z", writer: "described-shape-vessel", role: "described", id: "a466cb53" };
const PERSON = { input_refs: ["d0097dae"], r: 1, shape: "outcome", seq: 5500, t: "2026-11-11T14:00:00.000Z", writer: "key_person_1", role: "person", id: "b0b0b0b0" };
const RECORDS = [ANSWER, SYSTEM, PERSON];

/** records' read: shape, refs_to and `where` by equality, as records-vessel serves it. */
function read(p: Record<string, unknown>): unknown[] {
  const where = (p["where"] ?? {}) as Record<string, unknown>;
  return RECORDS.filter(
    (r) =>
      (p["shape"] === undefined || r.shape === p["shape"]) &&
      (p["refs_to"] === undefined || r.input_refs.includes(String(p["refs_to"]))) &&
      Object.entries(where).every(([k, v]) => String((r as Record<string, unknown>)[k]) === String(v)),
  );
}

const sent: Record<string, unknown>[] = [];
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.endsWith("/api/session")) return Response.json({ available: false, keySignIn: true, signedIn: true, person: { userId: "key_person_1", name: null, email: null, expiresAt: Date.now() + 900_000 } });
  if (url.includes("/api/discovery/resolve")) {
    const pointer = JSON.parse(String(init?.body)).pointer as Record<string, unknown>;
    sent.push(pointer);
    if (pointer["type"] === "record_read") return Response.json(pointer["shape"] === "answer" ? [ANSWER] : read(pointer));
    if (pointer["type"] === "record_write") return Response.json({ ok: true, seq: 5600, id: "row-5600" });
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
const button = (row: Element, text: string) => [...row.querySelectorAll("button")].find((b) => b.textContent === text) as HTMLButtonElement;
const row = (el: HTMLElement) => el.querySelector(`.sf-row[data-row="${ANSWER.id}"]`)!;
// The folded "What the walk answered" entry of the default landing, unfolded.
const answered = { ...DEFAULT_VIEWS.landing.entries.find((e) => e.title === "What the walk answered")!, folded: undefined };

describe("the system's own grade is drawn only after this person's verdict", () => {
  test("must-fail: before the person's verdict nothing of the system's grade is drawn or read", async () => {
    const el = await mount([answered]);
    const r = row(el);
    expect(r.querySelector("[data-system-grade]")).toBeNull();
    expect(r.textContent).not.toMatch(/graded|the system/i);
    expect(sent.filter((p) => p["shape"] === "outcome")).toEqual([]);
  });

  test("must-fail: after the person's verdict, one closed fold says the system graded this wrong, apart from Right and Wrong", async () => {
    const el = await mount([answered]);
    await act(async () => button(row(el), "Right").click());
    await settle();
    const folds = [...row(el).querySelectorAll("details[data-system-grade]")] as HTMLDetailsElement[];
    expect(folds.length).toBe(1);
    expect(folds[0]!.open).toBe(false);
    expect(folds[0]!.querySelector("summary")!.textContent).toBe("the system's own grade");
    expect([...folds[0]!.querySelectorAll("li")].map((li) => li.textContent!.split(" · ")[0])).toEqual(["the system graded this: wrong"]);
    expect(folds[0]!.closest('[role="group"]')).toBeNull();
  });

  test("must-fail: a person's outcome is never drawn as the system's grade", async () => {
    const el = await mount([answered]);
    await act(async () => button(row(el), "Wrong").click());
    await settle();
    const fold = row(el).querySelector("details[data-system-grade]")!;
    expect(fold.textContent).not.toContain("right");
    expect(sent.filter((p) => p["shape"] === "outcome")).toEqual([{ type: "record_read", refs_to: ANSWER.id, shape: "outcome", where: { role: "described" } }]);
  });

  test("must-fail: the default landing declares the system's grade on every answer it offers a verdict on", () => {
    const asks = DEFAULT_VIEWS.landing.entries.find((e) => e.title === "What people asked")!;
    const graded = { pointer: { type: "record_read", refs_to: "$row", shape: "outcome", where: { role: "described" } } };
    expect(asks.thread!.graded).toEqual(graded);
    expect(answered.graded).toEqual(graded);
  });
});
