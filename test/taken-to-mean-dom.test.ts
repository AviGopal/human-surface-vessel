/**
 * Under an ask's answer, what the request took the ask to mean: its reading in its own words and the
 * targets the ask is judged by, so a person grades the answer with the target in view. The read is
 * bound by the ask the rows were written for (their `root`), never by citation: a later ask's request
 * cites earlier asks in its pool. Rows written before targets were asked for draw nothing.
 *
 * Shapes: on a live node, a request's change_wanted row cited the ask it was for among 18 pool rows,
 * other asks among them, and named no target; its reading was the ask's words copied.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://surface.test/" });

import { afterAll, describe, expect, test } from "bun:test";
import { teardownDom, trackRoot } from "./setup.ts";
import { DEFAULT_VIEWS } from "../src/ui-views.ts";

const hex = (c: string): string => c.repeat(64);
const at = (seq: number): string => `2026-11-16T09:${String(seq).padStart(2, "0")}:00.000Z`;
const ask = (what: string, seq: number, id: string, refs: string[] = []) => ({ input_refs: refs, shape: "world_changed", what, seq, t: at(seq), writer: "key_person_1", role: "person", id });
const described = { writer: "described-shape-vessel", role: "described", producer: "a-model" };
const answer = (text: string, seq: number, id: string, cites: string, root: string | null) => ({ input_refs: [cites], text, shape: "answer", selection_ref: hex("9"), ...(root ? { root } : {}), seq, t: at(seq), ...described, id });
// As described writes it: the request's pool in input_refs, and once stamped, the ask it was for as root.
const wanted = (what: string, seq: number, id: string, pool: string[], extra: Record<string, unknown>) => ({ input_refs: pool, wanted: true, what, repo: "human-surface-vessel", shape: "change_wanted", context_omitted: 0, oldest_shown_seq: 1, selection_ref: hex("8"), call_id: "call-1", seq, t: at(seq), ...described, ...extra, id });

const A = ask("Put the page back as it was.", 1, hex("a"));
const B = ask("Show what waits on me first.", 2, hex("b"));
const C = ask("An ask from before targets.", 3, hex("c"));
const A_TARGET = { shape: "uiViewState", where: { region: "landing", "view.drawsDefault": true } };
const A_WANTED = wanted("Return the landing to its default layout.", 4, hex("d"), [C.id, A.id], { root: A.id, targets: [A_TARGET] });
const A_ANSWER = answer("The landing is back on its default.", 5, hex("e"), A.id, A.id);
// B's request cites A in its pool and is newer: bound by citation, it would replace A's under A.
const B_WANTED = wanted("Draw the questions above the asks.", 6, hex("f"), [A.id, B.id], { root: B.id, targets: [{ shape: "uiViewState", where: { region: "landing" } }] });
const B_ANSWER = answer("Questions now come first.", 7, hex("1"), B.id, B.id);
// Written before targets: no root on either row, no targets on the request.
const C_WANTED = wanted("An ask from before targets.", 8, hex("2"), [C.id], {});
const C_ANSWER = answer("Done before targets.", 9, hex("3"), C.id, null);
const ALL = [A, B, C, A_WANTED, A_ANSWER, B_WANTED, B_ANSWER, C_WANTED, C_ANSWER];

const sent: Record<string, unknown>[] = [];
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.endsWith("/api/session")) return Response.json({ available: false, keySignIn: true, signedIn: true, person: { userId: "key_person_1", name: null, email: null, expiresAt: Date.now() + 900_000 } });
  if (url.includes("/api/discovery/resolve")) {
    const p = JSON.parse(String(init?.body)).pointer as Record<string, unknown>;
    sent.push(p);
    if (p["type"] !== "record_read" || p["root"] !== undefined) return Response.json([]);
    // records' read: shape, refs_to, where (equality) and has compose; rows oldest first.
    const where = (p["where"] ?? {}) as Record<string, unknown>;
    return Response.json(ALL.filter((r) => {
      const o = r as Record<string, unknown>;
      return (p["shape"] === undefined || o["shape"] === p["shape"]) &&
        (p["refs_to"] === undefined || (o["input_refs"] as string[]).includes(String(p["refs_to"]))) &&
        (p["has"] === undefined || o[String(p["has"])] !== undefined) &&
        Object.entries(where).every(([k, v]) => o[k] !== undefined && String(o[k]) === String(v));
    }));
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

describe("what an ask was taken to mean is drawn under its answer", () => {
  test("must-fail: under the answer, the request's reading and its targets, bound by the ask as root", async () => {
    const el = await mount();
    const under = rowIn(rowIn(el, A.id)!, A_ANSWER.id)!;
    const taken = rowIn(under, A_WANTED.id);
    expect(taken).not.toBeNull();
    const text = taken!.textContent ?? "";
    expect(text).toContain(A_WANTED.what);
    expect(text).toContain("uiViewState");
    expect(text).toContain("view.drawsDefault");
    expect(sent).toContainEqual({ type: "record_read", shape: "change_wanted", where: { root: A.id }, has: "targets" });
  });

  test("must-fail: a later ask's request citing this ask in its pool is never drawn under it", async () => {
    const el = await mount();
    expect(rowIn(rowIn(el, A.id)!, B_WANTED.id)).toBeNull();
    expect(rowIn(rowIn(el, B.id)!, B_WANTED.id)).not.toBeNull();
  });

  test("control: rows written before targets draw nothing and read nothing for it", async () => {
    const el = await mount();
    expect(rowIn(rowIn(el, C.id)!, C_WANTED.id)).toBeNull();
    expect(rowIn(el, C_ANSWER.id)!.querySelector(".sf-thread")).toBeNull();
    expect(sent.some((p) => p["shape"] === "change_wanted" && JSON.stringify(p).includes(C.id))).toBe(false);
  });

  test("an answer with the reading under it stays a reply: no parent weight", async () => {
    const el = await mount();
    expect(rowIn(el, A.id)!.classList.contains("sf-row-parent")).toBe(true);
    expect(rowIn(el, A_ANSWER.id)!.classList.contains("sf-row-parent")).toBe(false);
  });
});
