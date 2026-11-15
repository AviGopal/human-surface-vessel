/**
 * A row's words holding a list of text are drawn as its items, one to a line, in the order the
 * producer wrote them. The page sorts nothing, so steps written out of time order stay as written.
 * The opened details are unchanged: every field as one value, a list of ids a count folded over
 * its marks, and a list of anything else one line of text.
 *
 * Shape: a summary of what the walk did with an ask lists its steps; drawn as words, the list ran
 * on one line as "steps chosen, called, returned".
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://surface.test/" });

import { afterAll, describe, expect, test } from "bun:test";
import { teardownDom, trackRoot } from "./setup.ts";

// Out of time order on purpose: the page must keep the order it was given.
const STEPS = ["stopped: waiting on you", "chose the file reader", "called the file reader: 3 files"];
const IDS = ["c", "d"].map((c) => c.repeat(64));
const ROW = { input_refs: IDS, shape: "account", said: "Read the files, then stopped.", steps: STEPS, counts: [1, 2], seq: 10, t: "2026-11-13T10:00:00.000Z", writer: "a producer", role: "described", id: "a".repeat(63) + "1" };

globalThis.fetch = (async (input: RequestInfo | URL) => {
  if (String(input).includes("/api/discovery/resolve")) return Response.json([ROW]);
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
const settle = async () => {
  for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
};
async function mount(): Promise<HTMLElement> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const entry = { pointer: { type: "record_read" }, form: "rows", title: "Rows", words: ["said", "steps"] };
  await act(async () => {
    createRoot(el).render(React.createElement(QueryClientProvider, { client: qc }, React.createElement(Entries, { entries: [entry] as never, enabled: true, intervalMs: 60_000, onOpenQuestion: () => {} })));
  });
  await settle();
  return el;
}
const row = (el: HTMLElement) => el.querySelector(`.sf-row[data-row="${ROW.id}"]`) as HTMLElement;
/** The row's details, opened, as field name → its <dd>. */
function opened(el: HTMLElement): Map<string, HTMLElement> {
  const d = row(el).querySelector("details.sf-row-details") as HTMLDetailsElement;
  d.open = true;
  return new Map([...d.querySelectorAll(".sf-row-field")].map((f) => [f.querySelector("dt")!.textContent!, f.querySelector("dd") as HTMLElement]));
}

describe("a list of text", () => {
  test("must-fail: in a row's words, its items one to a line, in the order written", async () => {
    const el = await mount();
    // The row's own words, not its details: happy-dom's :scope does not hold in querySelectorAll.
    const words = [...row(el).children].filter((c) => c.classList.contains("sf-row-words"));
    const items = words.flatMap((w) => [...w.querySelectorAll("ol > li")]).map((li) => li.textContent);
    expect(items).toEqual(STEPS);
    expect(row(el).textContent).not.toContain("steps ");
  });

  test("control: the opened details still hold the list in full, as one value", async () => {
    const el = await mount();
    const steps = opened(el).get("steps")!;
    expect(steps.querySelector("ol")).toBeNull();
    expect(steps.textContent).toBe(STEPS.join(", "));
    const refs = opened(el).get("input refs")!;
    expect(refs.querySelector("details > summary")!.textContent).toBe("2 ids");
  });

  test("control: a list of anything else is still one line of text", async () => {
    const el = await mount();
    const counts = opened(el).get("counts")!;
    expect(counts.querySelector("ol")).toBeNull();
    expect(counts.textContent).toBe("1, 2");
  });
});
