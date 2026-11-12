/**
 * A folded entry's summary counts its rows ("0 in all"). Opened with none, it adds nothing: no
 * second, machine-worded "answered with no rows" under the count. A producer's own reason for the
 * empty answer is still drawn, and an unfolded entry, which has no count, still says it is empty.
 *
 * Shape: one node 11-12. Each of the landing's three folded entries, opened, said "0 in all", then
 * "none in the last 24 hours", then "answered with no rows".
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://surface.test/" });

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { teardownDom, trackRoot } from "./setup.ts";
import { DEFAULT_VIEWS } from "../src/ui-views.ts";

let ANSWER: unknown = [];
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = String(input);
  if (url.endsWith("/api/session")) return Response.json({ keySignIn: true, signedIn: false });
  if (url.includes("/api/discovery/resolve")) return Response.json(ANSWER);
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
  document.body.replaceChildren();
  ANSWER = [];
});
const settle = async () => {
  for (let i = 0; i < 4; i++) await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
};
const failed = DEFAULT_VIEWS.landing.entries.find((e) => e.title === "What failed")!;

async function mount(entry: unknown): Promise<HTMLElement> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    createRoot(el).render(React.createElement(QueryClientProvider, { client: qc }, React.createElement(Entries, { entries: [entry] as never, enabled: true, intervalMs: 60_000, onOpenQuestion: () => {} })));
  });
  await settle();
  return el;
}

describe("a folded entry with no rows", () => {
  test("must-fail: opened, it adds nothing under its count", async () => {
    expect(failed.folded).toBe(true);
    const el = await mount(failed);
    const fold = el.querySelector("details.sf-report-folded") as HTMLDetailsElement;
    expect(fold.querySelector("summary")!.textContent).toContain("0 in all");
    expect(el.textContent).not.toContain("answered with no rows");
    expect(fold.querySelector(":scope > .sf-report-note")).toBeNull();
  });

  test("control: the producer's own reason is still drawn", async () => {
    ANSWER = { rows: [], empty_reason: "the store is being rebuilt" };
    const el = await mount({ ...failed, field: "rows" });
    expect(el.textContent).toContain("the store is being rebuilt");
  });

  test("control: an unfolded entry, which has no count, still says it is empty", async () => {
    const { folded: _f, strip: _s, ...open } = failed;
    const el = await mount(open);
    expect(el.textContent).toContain("answered with no rows");
  });
});
