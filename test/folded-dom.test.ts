/**
 * A view may fold an entry (surface-acts-on-shapes-present R.5): drawn closed under its title,
 * with the count of rows its read holds, so the evidence sits behind one control and is never
 * hidden uncounted. The landing puts the answer first and folds the raw reports under it.
 *
 * Shapes: one node 11-11. "What failed" drew ten bare "failure" rows of 1177, open, beside the
 * person's asks.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://surface.test/" });

import { afterAll, describe, expect, test } from "bun:test";
import { teardownDom, trackRoot } from "./setup.ts";

const hex = (c: string): string => c.repeat(64);
const failure = (n: number) => ({ input_refs: [], shape: "failure", body: `step ${n} failed`, seq: n, t: "2026-11-11T10:00:00.000Z", writer: "walk-vessel", role: "walk", id: hex(String(n % 10)) + String(n) });
const FAILURES = Array.from({ length: 12 }, (_, i) => failure(i + 1));

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.includes("/api/discovery/resolve")) {
    const pointer = JSON.parse(String(init?.body)).pointer as Record<string, unknown>;
    if (pointer["type"] === "record_read" && pointer["shape"] === "failure") return Response.json(FAILURES);
    if (pointer["type"] === "record_read") return Response.json([]);
    return Response.json({ resolved: false, success: false, error: "no producer" });
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
const failed = { pointer: { type: "record_read", shape: "failure" }, form: "rows", show: 3, title: "What failed" };

describe("a folded entry is closed and counted", () => {
  test("must-fail: drawn closed, its summary the title and the count of every row the read holds", async () => {
    const el = await mount([{ ...failed, folded: true }]);
    const fold = el.querySelector("details.sf-report-folded")!;
    expect(fold).not.toBeNull();
    expect(fold.hasAttribute("open")).toBe(false);
    expect(fold.querySelector("summary")!.textContent).toBe("What failed12");
    expect(fold.querySelector(".sf-report-count")!.getAttribute("data-count")).toBe("12");
    expect(inView(el)).not.toContain("the last 3 of 12");
  });

  test("must-fail: opening it shows what the entry draws unfolded", async () => {
    const el = await mount([{ ...failed, folded: true }]);
    const fold = el.querySelector("details.sf-report-folded")!;
    expect(fold.querySelectorAll(".sf-rows > .sf-row").length).toBe(3);
    expect(fold.textContent).toContain("the last 3 of 12");
  });

  test("must-fail: an unfolded entry is drawn open, as before", async () => {
    const el = await mount([failed]);
    expect(el.querySelector("details.sf-report-folded")).toBeNull();
    expect(inView(el)).toContain("the last 3 of 12");
  });

  test("a folded read with no answer says so under its title, with no count", async () => {
    const el = await mount([{ pointer: { type: "nothing_serves_this" }, form: "rows", title: "Elsewhere", folded: true }]);
    const fold = el.querySelector("details.sf-report-folded")!;
    expect(fold.querySelector(".sf-report-count")).toBeNull();
    expect(fold.querySelector("summary")!.textContent).toBe("Elsewhere");
  });
});
