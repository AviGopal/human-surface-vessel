/**
 * The steps an entry falls back through (qa on 9aefa13): its own form, then plain rows, then its
 * title alone; a title that is not words is never drawn as one; and new rows draw the entry again
 * in its own form, so a fallback lasts only while what it draws from is the same.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://surface.test/" });

import { afterAll, describe, expect, test } from "bun:test";
import { teardownDom, trackRoot } from "./setup.ts";

let rows: unknown[] = [{ shape: "answer", summary: "Done.", seq: 1, id: "a".repeat(64) }];
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = String(input);
  if (url.includes("/api/discovery/resolve")) return Response.json(rows);
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
const { useReport } = await import("../ui/src/api/queries");
const { Entries, EntryBoundary } = await import("../ui/src/components/Reports");
type Reading = import("../ui/src/components/Reports").Reading;
type DrawEntry = import("../ui/src/components/Reports").DrawEntry;

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterAll(async () => {
  await teardownDom();
});

const READING: Reading = { declared: new Map(), marks: new Map(), readers: [], faces: {}, enabled: true, intervalMs: 60_000, onOpenQuestion: () => {}, openQuestion: null };
const settle = async () => {
  for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
};
function providers(qc: InstanceType<typeof QueryClient>, child: unknown) {
  return React.createElement(QueryClientProvider, { client: qc }, React.createElement(LiveControlsProvider, null, React.createElement(QuestionsProvider, null, child)));
}
async function quietly(f: () => Promise<void>): Promise<void> {
  const was = console.error;
  console.error = () => {};
  try { await f(); } finally { console.error = was; }
}

describe("the steps an entry falls back through", () => {
  test("must-fail: a form that throws where plain rows do not draws the entry as plain rows, marked so", async () => {
    // A form only this entry's own form trips on: drawn as rows, it stands.
    const draw: DrawEntry = ({ entry }) => {
      if (entry.form !== "rows") throw new Error("this form cannot draw these rows");
      return React.createElement("section", { className: "sf-report", "data-drawn-as": entry.form });
    };
    const el = document.createElement("div");
    document.body.replaceChildren(el);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const entry = { pointer: { type: "record_read", shape: "answer" }, form: "questions", title: "Asked of me" };
    await quietly(async () => {
      await act(async () => { createRoot(el).render(providers(qc, React.createElement(EntryBoundary, { entry, reading: READING, draw }))); });
      await settle();
    });
    expect(el.querySelector('[data-entry-fallback="rows"] [data-drawn-as="rows"]')).not.toBeNull();
    expect(el.querySelector("[data-entry-failed]")).toBeNull();
  });

  test("must-fail: a title that is not words, on an entry whose rows also throw, draws the entry's own name, and the page stands", async () => {
    const el = document.createElement("div");
    document.body.replaceChildren(el);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const entries = [
      { pointer: { type: "record_read", shape: "failure" }, form: "rows", title: { what: "not words" }, words: 5 },
      { pointer: { type: "record_read", shape: "answer" }, form: "rows", title: "Fine" },
    ];
    await quietly(async () => {
      await act(async () => { createRoot(el).render(providers(qc, React.createElement(Entries, { entries, enabled: true, intervalMs: 60_000, onOpenQuestion: () => {} }))); });
      await settle();
    });
    const failed = el.querySelector("section[data-entry-failed]")!;
    expect(failed).not.toBeNull();
    expect(failed.querySelector(".sf-report-title")!.textContent).not.toContain("[object");
    expect(el.querySelector('section.sf-report[aria-label="Fine"]')!.textContent).toContain("Done.");
  });

  test("must-fail: new rows draw a fallen-back entry again in its own form", async () => {
    // Throws while its rows say so, in any form, so the entry is drawn as its title alone until they change.
    const draw: DrawEntry = ({ entry, reading }) => {
      const a = useReport(entry.pointer, { enabled: reading.enabled, intervalMs: reading.intervalMs }).data;
      if (a?.ok && JSON.stringify(a.answer).includes("cannot-draw")) throw new Error("these rows cannot be drawn");
      return React.createElement("section", { className: "sf-report", "data-drawn-as": entry.form });
    };
    rows = [{ shape: "answer", summary: "cannot-draw", seq: 1, id: "b".repeat(64) }];
    const el = document.createElement("div");
    document.body.replaceChildren(el);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const entry = { pointer: { type: "record_read", shape: "answer", where: { n: 3 } }, form: "rows", title: "Answers" };
    await quietly(async () => {
      await act(async () => { createRoot(el).render(providers(qc, React.createElement(EntryBoundary, { entry, reading: READING, draw }))); });
      await settle();
    });
    expect(el.querySelector("[data-entry-failed]")).not.toBeNull();
    rows = [{ shape: "answer", summary: "Done.", seq: 2, id: "c".repeat(64) }];
    await quietly(async () => {
      await act(async () => { await qc.refetchQueries(); });
      await settle();
    });
    expect(el.querySelector("[data-entry-failed]")).toBeNull();
    expect(el.querySelector('[data-drawn-as="rows"]')).not.toBeNull();
    expect(el.querySelector("[data-entry-fallback]")).toBeNull();
  });
});
