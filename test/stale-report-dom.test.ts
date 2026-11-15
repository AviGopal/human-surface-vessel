/**
 * A report read that fails after one that answered keeps the rows drawn, marked with when they
 * were read and that the latest read failed, the failure's words folded under "why" — as a failed
 * view read keeps the last view. A sign-in or a refusal is a state, and replaces the rows. Reads
 * that keep failing wait longer each time.
 *
 * Shape: node1 11-15, every landing read timed out at discovery's forward bound and the USER saw
 * each section as "no answer: forward_failed: The operation timed out." with the asks gone
 * (interface-as-shapes: a failed read must not make an ask vanish; EXPLICABILITY_SURFACE: stale
 * and failed are distinct states).
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://surface.test/" });

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { teardownDom, trackRoot } from "./setup.ts";
import { waitAfterMisses } from "../src/recheck.ts";

const ASK = { shape: "world_changed", what: "Make the message box hold ten lines.", seq: 10, t: "2026-11-15T11:00:00.000Z", role: "person", id: "a".repeat(64) };
const TIMED_OUT = { error: "forward_failed", reason: "The operation timed out." };

type Mode = "rows" | "timeout" | "refused" | "signIn";
let mode: Mode = "rows";
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = String(input);
  if (url.endsWith("/api/session")) return Response.json({ keySignIn: true, signedIn: true, person: { userId: "key_person_1", name: null, email: null, expiresAt: Date.now() + 900_000 } });
  if (url.includes("/api/discovery/resolve")) {
    if (mode === "timeout") return Response.json(TIMED_OUT, { status: 502 });
    if (mode === "refused") return Response.json({ failure: { status: 403, body: "not allowed for this key" } }, { status: 403 });
    if (mode === "signIn") return Response.json({ error: "sign_in_required" }, { status: 401 });
    return Response.json([ASK]);
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
const { Entries } = await import("../ui/src/components/Reports");
const { keepLastAnswer, missesOf } = await import("../ui/src/api/queries");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterAll(async () => {
  await teardownDom();
});
beforeEach(() => {
  mode = "rows";
  document.body.replaceChildren();
});
const settle = async () => {
  for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
};

const ASKS = { pointer: { type: "record_read", shape: "world_changed" }, form: "rows", words: ["what"], title: "What people asked" };

async function mount(entries: unknown[] = [ASKS]): Promise<{ el: HTMLElement; reread: () => Promise<void> }> {
  const el = document.createElement("div");
  el.className = "sf-landing";
  document.body.appendChild(el);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    createRoot(el).render(React.createElement(QueryClientProvider, { client: qc }, React.createElement(LiveControlsProvider, null, React.createElement(QuestionsProvider, null, React.createElement(Entries, { entries, enabled: true, intervalMs: 60_000, onOpenQuestion: () => {} })))));
  });
  await settle();
  const reread = async () => {
    await act(async () => { await qc.invalidateQueries({ queryKey: ["report"] }); });
    await settle();
  };
  return { el, reread };
}
const row = (el: HTMLElement) => el.querySelector(`.sf-row[data-row="${ASK.id}"]`);
const stale = (el: HTMLElement) => el.querySelector("[data-stale]") as HTMLElement | null;

describe("a read that fails after one that answered", () => {
  test("must-fail: the rows stay, marked as the read from before, with the failure's words folded under why", async () => {
    const { el, reread } = await mount();
    expect(row(el)).not.toBeNull();
    expect(stale(el)).toBeNull();
    mode = "timeout";
    await reread();
    expect(row(el)).not.toBeNull();
    expect(el.textContent).not.toContain("no answer");
    const note = stale(el)!;
    expect(note).not.toBeNull();
    expect(note.textContent).toContain("Showing the read from");
    expect(note.textContent).toContain("the latest read failed.");
    const why = note.querySelector("details.sf-stale-why") as HTMLDetailsElement;
    expect(why.open).toBe(false);
    expect(why.querySelector("[data-stale-reason]")!.textContent).toBe("forward_failed: The operation timed out.");
    expect(note.querySelector("time")!.getAttribute("datetime")).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test("must-fail: a second failure counts them and keeps when the rows were read", async () => {
    const { el, reread } = await mount();
    mode = "timeout";
    await reread();
    const since = stale(el)!.querySelector("time")!.getAttribute("datetime");
    await reread();
    expect(stale(el)!.textContent).toContain("(2 in a row)");
    expect(stale(el)!.querySelector("time")!.getAttribute("datetime")).toBe(since);
    expect(row(el)).not.toBeNull();
  });

  test("an answer after failures draws fresh, with no mark", async () => {
    const { el, reread } = await mount();
    mode = "timeout";
    await reread();
    mode = "rows";
    await reread();
    expect(stale(el)).toBeNull();
    expect(row(el)).not.toBeNull();
  });

  test("a refusal is a state, not a failure: it replaces the rows", async () => {
    const { el, reread } = await mount();
    mode = "refused";
    await reread();
    expect(row(el)).toBeNull();
    expect(stale(el)).toBeNull();
    expect(el.textContent).toContain("Not read: ");
  });

  test("a sign-in is a state, not a failure: it replaces the rows", async () => {
    const { el, reread } = await mount();
    mode = "signIn";
    await reread();
    expect(row(el)).toBeNull();
    expect(stale(el)).toBeNull();
  });

  test("control: a read that never answered still says so, with no rows to keep", async () => {
    mode = "timeout";
    const { el } = await mount();
    expect(row(el)).toBeNull();
    expect(stale(el)).toBeNull();
    expect(el.textContent).toContain("no answer: forward_failed: The operation timed out.");
  });

  test("folded, the summary says the rows are not current", async () => {
    const { el, reread } = await mount([{ ...ASKS, folded: true }]);
    mode = "timeout";
    await reread();
    expect(el.querySelector("summary [data-stale-mark]")!.textContent).toBe("not current");
  });
});

describe("what a failed read keeps, and how long the next waits", () => {
  const ok = { ok: true as const, shape: "world_changed", answer: [ASK] };
  const failed = { ok: false as const, reason: "forward_failed: The operation timed out." };

  test("must-fail: a failure after an answer keeps it, stale since it was read; a later one keeps that time", () => {
    const one = keepLastAnswer(ok, 1_000, failed);
    expect(one).toEqual({ ...ok, stale: { reason: failed.reason, since: 1_000, misses: 1 } });
    const two = keepLastAnswer(one, 5_000, failed);
    expect(two.ok && two.stale).toEqual({ reason: failed.reason, since: 1_000, misses: 2 });
  });

  test("a failure with nothing before counts itself; a refusal or sign-in replaces", () => {
    expect(keepLastAnswer(undefined, 0, failed)).toEqual({ ...failed, misses: 1 });
    expect(missesOf(keepLastAnswer({ ...failed, misses: 1 }, 0, failed))).toBe(2);
    const refused = { ok: false as const, reason: "not allowed", refused: true as const };
    expect(keepLastAnswer(ok, 1_000, refused)).toBe(refused);
  });

  test("the wait grows with the misses and stops at the policy's cap", () => {
    expect(waitAfterMisses(0, 60_000, 600_000)).toBe(0);
    expect(waitAfterMisses(1, 60_000, 600_000)).toBe(60_000);
    expect(waitAfterMisses(3, 60_000, 600_000)).toBe(240_000);
    expect(waitAfterMisses(9, 60_000, 600_000)).toBe(600_000);
  });
});

describe("one note per failure, not one per row", () => {
  const THREADED = { ...ASKS, thread: { pointer: { type: "record_read", refs_to: "$row", shape: "answer" }, form: "rows", words: ["text"] } };

  test("must-fail: when the section and its threads all fail, only the section says so", async () => {
    const { el, reread } = await mount([THREADED]);
    expect(el.querySelector(`[data-thread-of="${ASK.id}"]`)).not.toBeNull();
    mode = "timeout";
    await reread();
    expect(el.querySelectorAll("[data-stale]")).toHaveLength(1);
    expect(el.querySelector(`[data-thread-of="${ASK.id}"] [data-stale]`)).toBeNull();
  });
});
