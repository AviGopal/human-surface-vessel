/**
 * An entry's thread may be a list of reads (src/ui-views.ts MAX_THREADS). Under each row, each read
 * is bound to that row's id and drawn as its own entry, in the order the view lists them: an ask's
 * answer, which carries the person's verdict, and beside it another account of the same ask. The
 * page picks, sorts and groups nothing: what each read holds is its producer's, and the order is
 * the view's. A single thread is drawn as before.
 *
 * Shape: what the walk did with an ask (surface task 1.1a) is a read of its own, and the ask's one
 * thread was already its answer.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://surface.test/" });

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { teardownDom, trackRoot } from "./setup.ts";

const ASK = { input_refs: [], shape: "world_changed", what: "What is happening?", seq: 10, t: "2026-11-13T10:00:00.000Z", writer: "a person", role: "person", id: "a".repeat(64) };
const ANSWER = { input_refs: [ASK.id], shape: "answer", text: "Nothing is wrong.", seq: 12, t: "2026-11-13T10:02:00.000Z", writer: "a producer", role: "described", id: "b".repeat(64) };
const STEP = { input_refs: [ASK.id], shape: "account", said: "Read the files, then answered.", seq: 11, t: "2026-11-13T10:01:00.000Z", writer: "a reader", role: "records", id: "c".repeat(64) };
const ALL = [ASK, STEP, ANSWER];

const sent: Record<string, unknown>[] = [];
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.endsWith("/api/session")) return Response.json({ keySignIn: true, signedIn: true, person: { userId: "key_person_1", name: null, email: null, expiresAt: Date.now() + 900_000 } });
  if (url.includes("/api/discovery/resolve")) {
    const pointer = JSON.parse(String(init?.body)).pointer as Record<string, unknown>;
    sent.push(pointer);
    if (pointer["type"] !== "record_read") return Response.json({});
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
  document.body.replaceChildren();
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
const answers = { pointer: { type: "record_read", refs_to: "$row", shape: "answer" }, form: "rows", words: ["text"], judge: "outcome" };
const account = { pointer: { type: "record_read", refs_to: "$row", shape: "account" }, form: "rows", words: ["said"] };
const asks = (thread: unknown) => ({ pointer: { type: "record_read", shape: "world_changed" }, form: "rows", words: ["what"], thread });
/** The reads drawn under the ask, in page order, as the shape of the row each holds. */
function under(el: HTMLElement): string[] {
  const ask = el.querySelector(`.sf-row[data-row="${ASK.id}"]`)!;
  return [...ask.children].filter((c) => c.classList.contains("sf-thread")).map((t) => (t.querySelector(".sf-row[data-row]")?.getAttribute("data-row") === ANSWER.id ? "answer" : "account"));
}

describe("a thread that lists reads", () => {
  test("must-fail: under the ask, each read bound to its id, drawn in the view's order", async () => {
    const el = await mount([asks([account, answers])]);
    expect(under(el)).toEqual(["account", "answer"]);
    const el2 = await mount([asks([answers, account])]);
    expect(under(el2)).toEqual(["answer", "account"]);
    expect(sent).toEqual(expect.arrayContaining([{ type: "record_read", refs_to: ASK.id, shape: "answer" }, { type: "record_read", refs_to: ASK.id, shape: "account" }]));
    expect(JSON.stringify(sent)).not.toContain('"$row"');
  });

  test("must-fail: the verdict is offered only where the view asks for it", async () => {
    const el = await mount([asks([account, answers])]);
    const buttons = (id: string) => [...el.querySelectorAll(`.sf-row[data-row="${id}"] button`)].map((b) => b.textContent);
    expect(buttons(ANSWER.id)).toEqual(["Right", "Wrong"]);
    expect(buttons(STEP.id)).toEqual([]);
  });

  test("must-fail: a thread the view folds is one closed line under the row, its title and count", async () => {
    const el = await mount([asks([answers, { ...account, title: "What the walk did", folded: true }])]);
    const fold = el.querySelector(`.sf-row[data-row="${ASK.id}"] > details.sf-thread`) as HTMLDetailsElement;
    expect(fold).not.toBeNull();
    expect(fold.open).toBe(false);
    expect(fold.getAttribute("aria-label")).toBe("What the walk did");
    expect(fold.querySelector("summary")!.textContent).toBe("What the walk did1");
    expect(fold.querySelector("summary [data-count]")!.getAttribute("data-count")).toBe("1");
    // The answer, which carries the verdict, stays open beside it.
    expect(el.querySelector(`.sf-row[data-row="${ASK.id}"] > div.sf-thread .sf-row[data-row="${ANSWER.id}"]`)).not.toBeNull();
  });

  test("control: a single thread is drawn as before", async () => {
    const el = await mount([asks(answers)]);
    expect(under(el)).toEqual(["answer"]);
  });

  test("source: the page sorts and groups no rows; each read's rows are its producer's", () => {
    for (const file of ["../ui/src/components/Reports.tsx", "../src/row-words.ts"]) {
      const src = readFileSync(new URL(file, import.meta.url), "utf8");
      expect(src).not.toMatch(/\.sort\(|\.toSorted\(|groupBy/);
    }
  });
});
