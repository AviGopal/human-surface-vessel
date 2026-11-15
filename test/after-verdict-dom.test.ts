/**
 * Under a verdict given, the page shows the one fact the verdict's reader leaves (src/ui-views.ts
 * VERDICT_READERS, served with the view): for an answer, records' standing of the person's own grade,
 * read back by its id, with records' reason when it did not count; for a gap, its newest detector row
 * once one is newer than the row judged, else that the release has not read it yet; for a change,
 * only the record it was stored as. A field a row does not carry is not drawn, never as a "no".
 *
 * Shape: qa 11-15 ruling (A): the USER's Rights on gaps no one held were stored and nothing said
 * whether anything read them; research 11-15: a mark records refused is never silent.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://surface.test/" });

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { teardownDom, trackRoot } from "./setup.ts";
import { VERDICT_READERS } from "../src/ui-views.ts";

const ANSWER = { input_refs: [], shape: "answer", role: "described", text: "Both failed the typecheck.", seq: 10, t: "2026-11-15T11:00:00.000Z", id: "a".repeat(64) };
const GAP = { input_refs: [], shape: "gap", role: "detector", gap_id: "gap-test-a", status: "open", claim: "The test is right.", seq: 20, t: "2026-11-15T11:00:00.000Z", id: "b".repeat(64) };
const DIFF = { input_refs: [], shape: "gitDiff", role: "walk", repo: "box-vessel", tree: "3".repeat(40), diff: "", seq: 30, t: "2026-11-15T11:00:00.000Z", id: "c".repeat(64) };
const MINE = "f".repeat(64);

let outcomes: Record<string, unknown>[] = [];
let gapRows: Record<string, unknown>[] = [];
const reads: Record<string, unknown>[] = [];
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.endsWith("/api/session")) return Response.json({ keySignIn: true, signedIn: true, person: { userId: "key_person_1", name: null, email: null, expiresAt: Date.now() + 900_000 } });
  if (url.includes("/api/discovery/resolve")) {
    const pointer = JSON.parse(String(init?.body)).pointer as Record<string, unknown>;
    if (pointer["type"] === "record_write") return Response.json({ resolved: true, success: true, body: { ...(pointer["row"] as object), seq: 41, id: MINE } });
    if (pointer["type"] !== "record_read") return Response.json({});
    reads.push(pointer);
    if (pointer["shape"] === "answer") return Response.json([ANSWER]);
    if (pointer["shape"] === "gitDiff") return Response.json([DIFF]);
    if (pointer["shape"] === "gap") return Response.json(pointer["where"] && (pointer["where"] as Record<string, unknown>)["gap_id"] ? gapRows : [GAP]);
    if (pointer["shape"] === "outcome") return Response.json(outcomes);
    return Response.json([]);
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
  outcomes = [];
  gapRows = [GAP];
  reads.length = 0;
  document.body.replaceChildren();
});
const settle = async () => {
  for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
};

const entry = (shape: string, judge: "outcome" | "land") => ({ pointer: { type: "record_read", shape }, form: "rows", judge });
async function judged(shape: string, judge: "outcome" | "land", word: "Right" | "Wrong", readers: unknown = VERDICT_READERS): Promise<HTMLElement> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    createRoot(el).render(React.createElement(QueryClientProvider, { client: qc }, React.createElement(Entries, { entries: [entry(shape, judge)], readers, enabled: true, intervalMs: 60_000, onOpenQuestion: () => {} })));
  });
  await settle();
  const b = [...el.querySelectorAll(".sf-judge-word")].find((x) => x.textContent === word) as HTMLButtonElement;
  await act(async () => { b.click(); });
  await settle();
  return el;
}
const fact = (el: HTMLElement) => el.querySelector("[data-after-verdict]")?.textContent ?? null;

describe("an answer's grade, read back", () => {
  test("must-fail: one records counted says so, read by the answer and picked by the grade's own id", async () => {
    outcomes = [
      { shape: "outcome", r: 1, input_refs: [ANSWER.id], id: "e".repeat(64), seq: 40, standing: { counted: false, why: "replaced" } },
      { shape: "outcome", r: 1, input_refs: [ANSWER.id], id: MINE, seq: 41, standing: { counted: true } },
    ];
    const el = await judged("answer", "outcome", "Right");
    expect(reads).toContainEqual({ type: "record_read", refs_to: ANSWER.id, shape: "outcome" });
    expect(fact(el)).toBe("Your grade counted.");
  });

  test("must-fail: one records refused says so, with records' reason", async () => {
    outcomes = [{ shape: "outcome", r: 0, input_refs: [ANSWER.id], id: MINE, seq: 41, standing: { counted: false, why: "not_a_grader" } }];
    const el = await judged("answer", "outcome", "Wrong");
    expect(fact(el)).toBe("Your grade did not count: not a grader.");
  });

  test("a grade not read back yet, or with no standing, says nothing", async () => {
    outcomes = [{ shape: "outcome", r: 1, input_refs: [ANSWER.id], id: MINE, seq: 41 }];
    const el = await judged("answer", "outcome", "Right");
    expect(fact(el)).toBeNull();
  });
});

describe("a gap's release, read from the gap", () => {
  test("must-fail: a newer detector row is shown by its status, and its check set aside when it says so", async () => {
    gapRows = [{ ...GAP, seq: 25, id: "d".repeat(64), status: "open", check_runnable: false }];
    const el = await judged("gap", "outcome", "Wrong");
    expect(reads).toContainEqual({ type: "record_read", shape: "gap", latest_by: "gap_id", where: { gap_id: GAP.gap_id } });
    expect(fact(el)).toBe("The release read it: the gap is now open · its test is set aside until a reviewed fix.");
  });

  test("must-fail: a newer row without check_runnable draws no word about it", async () => {
    gapRows = [{ ...GAP, seq: 25, id: "d".repeat(64), status: "closed" }];
    const el = await judged("gap", "outcome", "Right");
    expect(fact(el)).toBe("The release read it: the gap is now closed.");
  });

  test("must-fail: no newer row: waiting for the release, and nothing about a hold", async () => {
    const el = await judged("gap", "outcome", "Right");
    expect(fact(el)).toBe("Waiting for the release to read it.");
    expect(el.textContent!.toLowerCase()).not.toContain("hold");
  });
});

describe("a change's verdict", () => {
  test("only the record it was stored as: no read follows it", async () => {
    const el = await judged("gitDiff", "land", "Wrong");
    expect(el.querySelector(".sf-judge-given")!.textContent).toBe("record #41");
    expect(fact(el)).toBeNull();
    expect(reads.filter((p) => p["shape"] !== "gitDiff" && p["shape"] !== "shape_description")).toEqual([]);
  });
});

test("control: a view served with no readers shows the record only", async () => {
  outcomes = [{ shape: "outcome", r: 1, input_refs: [ANSWER.id], id: MINE, seq: 41, standing: { counted: true } }];
  const el = await judged("answer", "outcome", "Right", []);
  expect(fact(el)).toBeNull();
});
