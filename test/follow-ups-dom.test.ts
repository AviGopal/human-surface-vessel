/**
 * A person's follow-up is drawn under the ask it continues, with its own answer under it: one
 * conversation, held together by the citation the box writes when a person asks about an ask
 * (the ask and the answer it was shown). The page groups nothing: the thread is records' read of
 * the person's asks citing that ask, and the follow-up's answer is a thread of that thread.
 *
 * Shapes: on a live node, a person's ask about where messages come from cited an earlier ask
 * about the page and its answer, and was drawn as an ask of its own, away from the one it
 * continued.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://surface.test/" });

import { afterAll, describe, expect, test } from "bun:test";
import { teardownDom, trackRoot } from "./setup.ts";
import { DEFAULT_VIEWS } from "../src/ui-views.ts";

const hex = (c: string): string => c.repeat(64);
const person = { writer: "key_person_1", role: "person" };
const said = (what: string, seq: number, id: string, refs: string[]) => ({ input_refs: refs, shape: "world_changed", what, seq, t: `2026-11-16T09:${String(seq).padStart(2, "0")}:00.000Z`, ...person, id });
const answer = (text: string, seq: number, id: string, refs: string[]) => ({ input_refs: refs, text, shape: "answer", selection_ref: hex("9"), producer: "a-model", seq, t: `2026-11-16T09:${String(seq).padStart(2, "0")}:30.000Z`, writer: "described-shape-vessel", role: "described", id });

const ROOT = said("What does the page show?", 1, hex("a"), []);
const ROOT_ANSWER = answer("Asks, answers and what waits.", 2, hex("b"), [ROOT.id]);
const FOLLOW = said("Who wrote each row?", 3, hex("c"), [ROOT.id, ROOT_ANSWER.id]);
const FOLLOW_ANSWER = answer("Each row names its writer.", 4, hex("d"), [FOLLOW.id]);
// The walk cites the ask in rows of its own; only a person's ask citing it is a follow-up.
const WALK_ROW = { input_refs: [ROOT.id], shape: "world_changed", what: "a row the walk wrote", seq: 5, t: "2026-11-16T09:05:00.000Z", writer: "walk-vessel", role: "walk", id: hex("e") };
let ALL = [ROOT, ROOT_ANSWER, FOLLOW, FOLLOW_ANSWER, WALK_ROW];

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.endsWith("/api/session")) return Response.json({ available: false, keySignIn: true, signedIn: true, person: { userId: "key_person_1", name: null, email: null, expiresAt: Date.now() + 900_000 } });
  if (url.includes("/api/discovery/resolve")) {
    const p = JSON.parse(String(init?.body)).pointer as Record<string, unknown>;
    if (p["type"] !== "record_read" || p["root"] !== undefined) return Response.json([]);
    // records' read: shape, refs_to and where (equality) compose; rows oldest first.
    const where = (p["where"] ?? {}) as Record<string, unknown>;
    return Response.json(ALL.filter((r) =>
      (p["shape"] === undefined || r.shape === p["shape"]) &&
      (p["refs_to"] === undefined || r.input_refs.includes(String(p["refs_to"]))) &&
      Object.entries(where).every(([k, v]) => String((r as Record<string, unknown>)[k]) === String(v))));
  }
  return Response.json({});
}) as typeof fetch;

const uiSrc = new URL("../ui/src/", import.meta.url).pathname;
const React = await import(Bun.resolveSync("react", uiSrc));
const { createRoot: rawCreateRoot } = await import(Bun.resolveSync("react-dom/client", uiSrc));
const createRoot = (...a: Parameters<typeof rawCreateRoot>) => trackRoot(rawCreateRoot(...a));
const { act } = React;
const { QueryClient, QueryClientProvider } = await import(Bun.resolveSync("@tanstack/react-query", uiSrc));
const { Entries, offersVerdicts } = await import("../ui/src/components/Reports");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterAll(async () => {
  await teardownDom();
});

const asked = DEFAULT_VIEWS.landing.entries.find((e) => e.title === "Asked of me")!;
async function mount(): Promise<HTMLElement> {
  const el = document.createElement("div");
  document.body.replaceChildren(el);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    createRoot(el).render(React.createElement(QueryClientProvider, { client: qc }, React.createElement(Entries, { entries: [asked] as never, enabled: true, intervalMs: 60_000, onOpenQuestion: () => {} })));
  });
  for (let i = 0; i < 10; i++) await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  return el;
}
const rowIn = (scope: Element, id: string): Element | null => scope.querySelector(`.sf-row[data-row="${id}"]`);
const threadsOf = (row: Element): Element[] => [...row.children].filter((c) => c.matches(".sf-thread"));
// The words of the rows a thread draws itself, not of the threads under them.
const words = (scope: Element): string[] =>
  [...scope.children].filter((c) => c.matches("ol")).flatMap((ol) => [...ol.children]).flatMap((li) => [...li.children].filter((c) => c.matches(".sf-row-words"))).map((p) => p.textContent ?? "");

describe("a follow-up is drawn under the ask it continues", () => {
  test("must-fail: under the ask, the person's follow-up citing it, and under the follow-up its own answer", async () => {
    const el = await mount();
    const root = rowIn(el, ROOT.id)!;
    const follow = threadsOf(root).map((t) => rowIn(t, FOLLOW.id)).find((r) => r !== null);
    expect(follow).toBeDefined();
    expect(follow!.querySelector(".sf-row-words")!.textContent).toBe(FOLLOW.what);
    const under = threadsOf(follow!);
    expect(under.map(words).flat()).toEqual(["Each row names its writer."]);
    // The follow-up's answer takes a verdict, as the ask's own does.
    expect(under[0]!.querySelectorAll(".sf-row-judge").length).toBe(1);
  });

  test("must-fail: only a person's ask citing it is a follow-up; the ask's own answer stays first under it", async () => {
    const el = await mount();
    const root = rowIn(el, ROOT.id)!;
    expect(threadsOf(root).some((t) => rowIn(t, WALK_ROW.id) !== null)).toBe(false);
    expect(words(threadsOf(root)[0]!)).toEqual([ROOT_ANSWER.text]);
  });

  test("two levels at most: a follow-up's answer draws no thread of its own", async () => {
    const el = await mount();
    const follow = threadsOf(rowIn(el, ROOT.id)!).map((t) => rowIn(t, FOLLOW.id)).find((r) => r !== null)!;
    const answerRow = rowIn(threadsOf(follow)[0]!, FOLLOW_ANSWER.id)!;
    expect(threadsOf(answerRow)).toHaveLength(0);
  });

  test("must-fail: a verdict offered only on a follow-up's answer still draws the page's one sign-in line", () => {
    const read = (shape: string) => ({ type: "record_read", refs_to: "$row", shape });
    const judgedBelow = { pointer: { type: "record_read", shape: "world_changed" }, form: "rows", thread: { pointer: read("world_changed"), form: "rows", thread: { pointer: read("answer"), form: "rows", judge: "outcome" } } };
    expect(offersVerdicts([judgedBelow] as never)).toBe(true);
    expect(offersVerdicts([{ ...judgedBelow, thread: { pointer: read("world_changed"), form: "rows" } }] as never)).toBe(false);
  });

  test("must-fail: the view bounds the follow-ups under an ask: the newest three, the rest a count", async () => {
    // Older in records' order than the ask's own rows, so the ask stays among the newest asks drawn.
    const more = [6, 7, 8].map((n) => said(`Follow-up ${n}.`, n, hex(String(n)), [ROOT.id, ROOT_ANSWER.id]));
    const was = ALL;
    ALL = [...more, ...ALL];
    try {
      const el = await mount();
      const list = threadsOf(rowIn(el, ROOT.id)!).find((t) => rowIn(t, FOLLOW.id) !== null)!;
      expect(words(list)).toEqual(["Follow-up 7.", "Follow-up 8.", FOLLOW.what]);
      expect(list.querySelector("details.sf-earlier > summary")!.textContent).toBe("1 earlier");
    } finally {
      ALL = was;
    }
  });
});
