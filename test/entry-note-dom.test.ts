/**
 * An entry drawn open may carry a `note`: one short line under its title saying what its rows are
 * for, so the title can stay a name. It is drawn only while the read has rows (with none there is
 * nothing to act on), and is refused on a folded entry or in a thread, where nothing would draw it.
 *
 * Shape: the USER 11-15, "What can we do to improve the visual design": the failing checks' title
 * carried its whole explanation in capitals and wrapped to two heavy lines on a phone.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://surface.test/" });

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { teardownDom, trackRoot } from "./setup.ts";
import { DEFAULT_VIEWS, resetViewsForTest, writeView } from "../src/ui-views.ts";

const GAP = { input_refs: [], shape: "gap", role: "detector", gap_id: "gap-test-a", status: "open", claim: "The test is right.", seq: 20, t: "2026-11-15T11:00:00.000Z", id: "b".repeat(64) };
let gaps: unknown[] = [];
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.endsWith("/api/session")) return Response.json({ keySignIn: true, signedIn: true, person: { userId: "key_person_1", name: null, email: null, expiresAt: Date.now() + 900_000 } });
  if (url.includes("/api/discovery/resolve")) {
    const pointer = JSON.parse(String(init?.body)).pointer as Record<string, unknown>;
    if (pointer["type"] === "uiQuestion") return Response.json({ questions: [{ id: "q1", title: "Which branch?", kind: "decision", status: "open" }] });
    return Response.json(pointer["type"] === "record_read" && pointer["shape"] === "gap" ? gaps : []);
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
  gaps = [GAP];
  document.body.replaceChildren();
});
const settle = async () => {
  for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
};
const failing = DEFAULT_VIEWS.landing.entries.find((e) => e.title === "Failing checks")!;
async function mount(entries: unknown[]): Promise<HTMLElement> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    createRoot(el).render(React.createElement(QueryClientProvider, { client: qc }, React.createElement(Entries, { entries, enabled: true, intervalMs: 60_000, onOpenQuestion: () => {} })));
  });
  await settle();
  return el;
}

describe("an entry's note", () => {
  test("must-fail: the failing checks are titled by name, and what a verdict does is the note under it", async () => {
    expect(failing.note).toBe("Right releases a held one; Wrong marks its test wrong.");
    const el = await mount([failing]);
    const section = el.querySelector("section.sf-report")!;
    expect(section.querySelector("h2")!.textContent).toBe("Failing checks");
    const note = section.querySelector("[data-note]")!;
    expect(note.textContent).toBe(failing.note!);
    expect(note.previousElementSibling!.tagName).toBe("H2");
  });

  test("a questions entry with a question draws its note", async () => {
    const el = await mount([{ pointer: { type: "uiQuestion", open: true }, form: "questions", field: "questions", title: "Waiting on you", note: "Answer these first." }]);
    expect(el.querySelector("[data-note]")?.textContent).toBe("Answer these first.");
  });

  test("must-fail: with no rows there is nothing to act on, and no note", async () => {
    gaps = [];
    const el = await mount([failing]);
    expect(el.querySelector("[data-note]")).toBeNull();
    expect(el.textContent).toContain("No check is failing.");
  });

  test("must-fail: the contract takes a note on an open entry, and refuses it folded, in a thread, on fields, too long or blank", () => {
    const pointer = { type: "record_read", shape: "gap" };
    const open = writeView({ region: "landing", entries: [{ pointer, form: "rows", title: "A", note: "What these are for." }] }, null);
    resetViewsForTest();
    expect(open.ok).toBe(true);
    for (const entry of [
      { pointer, form: "rows", folded: true, note: "x" },
      { pointer: { type: "record_read", shape: "world_changed" }, form: "rows", thread: { pointer: { type: "record_read", refs_to: "$row", shape: "answer" }, form: "rows", note: "x" } },
      { pointer, form: "rows", note: "x".repeat(121) },
      { pointer, form: "rows", note: " " },
      // A fields entry has no rows, so a note there would never be drawn.
      { pointer: { type: "record_read", shape: "fixture_fields" }, form: "fields", note: "x" },
    ]) {
      const w = writeView({ region: "landing", entries: [entry] }, null);
      expect(w.ok).toBe(false);
      expect(w.ok ? "" : w.detail).toContain("note");
    }
  });
});
