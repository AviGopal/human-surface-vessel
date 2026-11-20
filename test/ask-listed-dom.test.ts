/**
 * An ask written draws nothing under the box. It is followed where it is listed: first among the
 * person's asks on the landing, its answer and what the walk did with it as its thread. The box
 * says it went only to a screen reader, and the page reads its reads again so the ask is listed
 * at once. Only a send that did not go through takes a line under the box.
 *
 * Shape: node1 11-15. "Asked (record #41631). What the system does with it appears below." stood
 * in a green bar over two boxes, "Not answered yet." and "0", above the landing that listed the
 * same ask with the same answer; it held the top of the page until dismissed.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://surface.test/" });

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { teardownDom, trackRoot } from "./setup.ts";

const ASK_ID = "row-ask-2434";
let citing: Record<string, unknown>[] = [];
const viewReads: string[] = [];
const reads: Record<string, unknown>[] = [];
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
  const person = { userId: "user:person-a", name: "Person A", expiresAt: Date.now() + 900_000 };
  if (url.endsWith("/api/session")) return Response.json({ keySignIn: true, signedIn: true, person });
  if (url.includes("/api/ui-view")) { viewReads.push(url); return Response.json({ region: "landing", revision: 0, id: "landing@0", notDrawn: null, entries: [] }); }
  if (url.endsWith("/api/discovery/resolve")) {
    const pointer = body["pointer"] as Record<string, unknown>;
    if (pointer["type"] === "record_write") return Response.json({ resolved: true, success: true, body: { ...(pointer["row"] as object), seq: 2434, id: ASK_ID } });
    reads.push(pointer);
    return Response.json({ resolved: true, success: true, body: citing.filter((r) => pointer["shape"] === undefined || r["shape"] === pointer["shape"]) });
  }
  if (url.includes("/api/questions")) return Response.json({ resolved: true, success: true, body: { questions: [] } });
  return Response.json({ resolved: true, success: true, body: {} });
}) as typeof fetch;

const uiSrc = new URL("../ui/src/", import.meta.url).pathname;
const React = await import(Bun.resolveSync("react", uiSrc));
const { createRoot: rawCreateRoot } = await import(Bun.resolveSync("react-dom/client", uiSrc));
const createRoot = (...a: Parameters<typeof rawCreateRoot>) => trackRoot(rawCreateRoot(...a));
const { act } = React;
const { QueryClient, QueryClientProvider } = await import(Bun.resolveSync("@tanstack/react-query", uiSrc));
const { LiveControlsProvider } = await import("../ui/src/state/liveControls");
const { QuestionsProvider } = await import("../ui/src/state/questions");
const { TopBar } = await import("../ui/src/components/TopBar");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterAll(async () => {
  await teardownDom();
});
beforeEach(() => {
  citing = [];
  viewReads.length = 0;
  reads.length = 0;
});

const settle = async () => {
  for (let i = 0; i < 4; i++) await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
};

async function askHello(given?: InstanceType<typeof QueryClient>): Promise<{ el: HTMLElement; qc: InstanceType<typeof QueryClient> }> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const qc = given ?? new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    createRoot(el).render(
      React.createElement(QueryClientProvider, { client: qc }, React.createElement(LiveControlsProvider, null, React.createElement(QuestionsProvider, null, React.createElement(TopBar, {})))),
    );
  });
  await settle();
  const box = el.querySelector("textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!.call(box, "Hello");
    box.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => { box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
  await settle();
  return { el, qc };
}

describe("an ask is followed where it is listed", () => {
  test("must-fail: a written ask draws no line, no view and no read under the box", async () => {
    citing = [{ shape: "answer", id: "row-answer-1", text: "Not yet.", input_refs: [ASK_ID], t: "2026-11-15T04:38:52.000Z" }];
    const { el } = await askHello();
    expect(el.querySelector(".sf-outcome-line")).toBeNull();
    expect(el.querySelector(".sf-row")).toBeNull();
    expect(el.textContent).not.toContain("The answer so far");
    expect(el.textContent).not.toContain("What the system did for it");
    expect(viewReads).toEqual([]);
    expect(reads.filter((p) => p["type"] === "record_read")).toEqual([]);
  });

  test("must-fail: the box says the ask went only to a screen reader, and empties", async () => {
    const { el } = await askHello();
    const said = el.querySelector(".sf-visually-hidden[role='status']")!;
    expect(said.textContent).toBe("Asked (record #2434).");
    expect(el.querySelector("textarea")!.value).toBe("");
  });

  test("must-fail: the page's reads are read again at once, so the ask is listed without waiting for the poll", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let landing = 0;
    await qc.prefetchQuery({ queryKey: ["report", "asks"], queryFn: () => ++landing });
    const { QueryObserver } = await import(Bun.resolveSync("@tanstack/react-query", uiSrc));
    const stop = new QueryObserver(qc, { queryKey: ["report", "asks"], queryFn: () => ++landing, staleTime: Infinity }).subscribe(() => {});
    await askHello(qc);
    expect(landing).toBe(2);
    stop();
  });
});
