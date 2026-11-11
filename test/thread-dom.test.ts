/**
 * A person's asks are threads (surface-acts-on-shapes-present R.4). A view entry may name one
 * further read drawn under each row, its pointer bound to that row's id through "$row", as the
 * ask region binds "$ask". The rows under an ask are that read's answer: the page filters, sorts
 * and dedupes nothing, one level only, and the view bounds it (the thread's own `show`, with a cut
 * shown as a count). The default landing reads each ask's answers (records filters by shape), so
 * a newer selection row citing the ask never pushes its answer out of view.
 *
 * Shapes: one node 11-11. A person asked "Close any known gap by changing the code." and the
 * walk's answer to it was drawn in another column, among 70 others, with nothing tying the two.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://surface.test/" });

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { teardownDom, trackRoot } from "./setup.ts";
import { DEFAULT_VIEWS } from "../src/ui-views.ts";

const hex = (c: string): string => c.repeat(64);
const ASK_A = { input_refs: [], shape: "world_changed", what: "Close any known gap by changing the code.", seq: 10, t: "2026-11-11T11:55:14.411Z", writer: "key_person_1", role: "person", id: hex("a") };
const ASK_B = { input_refs: [], shape: "world_changed", what: "Hello", seq: 5, t: "2026-11-10T22:42:00.000Z", writer: "key_person_1", role: "person", id: hex("b") };
const answer = (n: number, ask: string) => ({ input_refs: [ask], text: `Answer ${n}.`, shape: "answer", selection_ref: hex("5"), producer: "a-model", seq: 20 + n, t: "2026-11-11T11:56:00.000Z", writer: "described-shape-vessel", role: "described", id: `${n}`.repeat(64).slice(0, 64) });
const ANSWERS = [1, 2, 3, 4].map((n) => answer(n, ASK_A.id));
// Newer than every answer, citing the same ask: what a raw thread's "last n" would show instead.
const SELECTIONS = [1, 2, 3].map((n) => ({ input_refs: [ASK_A.id], shape: "selection", seq: 40 + n, t: "2026-11-11T12:20:00.000Z", writer: "walk-vessel", role: "walk", id: hex(String.fromCharCode(99 + n)) }));
const ALL = [ASK_B, ASK_A, ...ANSWERS, ...SELECTIONS];

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
const askRow = (el: HTMLElement, id: string): Element => el.querySelector(`.sf-row[data-row="${id}"]`)!;
const threadOf = (el: HTMLElement, id: string): Element => [...askRow(el, id).children].find((c) => c.matches(`.sf-thread[data-thread-of="${id}"]`))!;

describe("a person's ask is a thread", () => {
  test("must-fail: under each ask, the rows its thread reads, bound to that ask's id; the literal binding is never sent", async () => {
    const el = await mount([asked]);
    const threads = sent.filter((p) => p["refs_to"] !== undefined);
    expect(threads).toEqual(expect.arrayContaining([
      { type: "record_read", refs_to: ASK_A.id, shape: "answer" },
      { type: "record_read", refs_to: ASK_B.id, shape: "answer" },
    ]));
    expect(sent.some((p) => Object.values(p).includes("$row"))).toBe(false);
    expect([...threadOf(el, ASK_A.id).querySelectorAll(".sf-row-words")].map((p) => p.textContent)).toEqual(["Answer 2.", "Answer 3.", "Answer 4."]);
  });

  test("must-fail: the thread's own show bounds it and the cut is a count; an ask with none says so", async () => {
    const el = await mount([asked]);
    expect(threadOf(el, ASK_A.id).textContent).toContain("the last 3 of 4");
    expect(threadOf(el, ASK_B.id).textContent).toContain("Not answered yet.");
  });

  test("must-fail: a newer system row citing the ask never pushes its answer out of view", async () => {
    const el = await mount([asked]);
    const shown = inView(threadOf(el, ASK_A.id));
    expect(shown).toContain("Answer 4.");
    expect(shown).not.toContain("selection");
  });

  test("must-fail: each answer under an ask takes a verdict, and nothing above a fold is an id", async () => {
    const el = await mount([asked]);
    const thread = threadOf(el, ASK_A.id);
    expect(thread.querySelectorAll(".sf-row-judge").length).toBe(3);
    expect(inView(askRow(el, ASK_A.id))).not.toMatch(/[0-9a-f]{64}|key_|input refs/);
  });

  test("one level: a thread's rows draw no thread of their own", async () => {
    const el = await mount([asked]);
    expect(threadOf(el, ASK_A.id).querySelector(".sf-thread")).toBeNull();
  });

  test("a view naming the raw thread draws every row citing the ask, in the producer's order", async () => {
    const raw = { ...asked, thread: { pointer: { type: "record_read", refs_to: "$row" }, form: "rows", show: 10 } };
    const el = await mount([raw]);
    const list = [...threadOf(el, ASK_A.id).children].find((c) => c.tagName === "OL")!;
    const shapes = [...list.children].map((r) => r.querySelector(".sf-row-words")!.textContent);
    expect(shapes).toEqual(["answer", "answer", "answer", "answer", "selection", "selection", "selection"]);
  });
});
