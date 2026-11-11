/**
 * After an ask is written, the box draws the `ask` region's view under it, with the ask's own
 * row id bound where the view says "$ask". By default that is the latest reply to the ask in
 * words, then every row citing it folded and counted, and before it is answered the page says so
 * in plain words. A view written for the region replaces what follows an ask; the surface supplies
 * only the id.
 *
 * Shape: one node 11-11. The ports ask was cited by 28 rows, 18 of them the walk's choices; the
 * follow drew all 28 open under the box, about 2000 px, each a bare shape name and a timestamp.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://surface.test/" });

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { teardownDom, trackRoot } from "./setup.ts";
import { DEFAULT_VIEWS } from "../src/ui-views.ts";

const ASK_ID = "row-ask-2434";
let citing: Record<string, unknown>[] = [];
let askView: { entries: readonly unknown[] } = DEFAULT_VIEWS.ask;
const reads: Record<string, unknown>[] = [];
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
  const person = { userId: "user:person-a", name: "Person A", expiresAt: Date.now() + 900_000 };
  if (url.endsWith("/api/session")) return Response.json({ keySignIn: true, signedIn: true, person });
  if (url.includes("/api/ui-view?region=ask")) return Response.json({ region: "ask", revision: 1, id: "ask@1", ...askView });
  if (url.endsWith("/api/surface-intent")) return new Response("{}", { status: 422 });
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
  askView = DEFAULT_VIEWS.ask;
  reads.length = 0;
});

const settle = async () => {
  for (let i = 0; i < 4; i++) await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
};

async function askHello(): Promise<{ el: HTMLElement; qc: InstanceType<typeof QueryClient> }> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    createRoot(el).render(
      React.createElement(QueryClientProvider, { client: qc }, React.createElement(LiveControlsProvider, null, React.createElement(QuestionsProvider, null, React.createElement(TopBar, { openIssues: null, onToggleIssues: () => {}, issuesOpen: false })))),
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

describe("the box follows an ask", () => {
  test("must-fail: the follow-up reads the replies to the ask by its own id, and says so when there are none", async () => {
    const { el } = await askHello();
    expect(el.textContent).toContain("Asked (record #2434).");
    expect(reads).toContainEqual({ type: "record_read", refs_to: ASK_ID, shape: "answer" });
    expect(reads).toContainEqual({ type: "record_read", refs_to: ASK_ID });
    expect(el.querySelector("[aria-label='The answer so far']")?.textContent).toContain("Not answered yet.");
  });

  test("must-fail: a view written for the ask region replaces what follows an ask", async () => {
    askView = { entries: [{ pointer: { type: "record_read", shape: "answer", refs_to: "$ask" }, form: "rows", title: "Answers to it", empty: "Not answered yet." }] };
    const { el } = await askHello();
    expect(reads).toContainEqual({ type: "record_read", shape: "answer", refs_to: ASK_ID });
    expect(reads).not.toContainEqual({ type: "record_read", refs_to: ASK_ID });
    expect(el.querySelector("[aria-label='Answers to it']")?.textContent).toContain("Not answered yet.");
    expect(el.textContent).not.toContain("The answer so far");
  });

  test("must-fail: the reply is drawn open in words; the walk's own rows are folded and counted, not drawn", async () => {
    const step = (i: number) => ({ shape: "selection", id: `row-sel-${i}`, input_refs: [ASK_ID, "6966cc456396b37fd25db92f329eb575b3df60478ff7c4e6c4b4fbcc27ecd61e"], t: `2026-11-11T15:4${i}:00.000Z` });
    citing = [step(0), step(1), { shape: "answer", id: "row-answer-1", text: "It is 08:10 in Lisbon.", input_refs: [ASK_ID], t: "2026-11-11T15:42:00.000Z" }, step(3)];
    const { el } = await askHello();
    const answer = el.querySelector("[aria-label='The answer so far']")!;
    expect(answer.textContent).toContain("It is 08:10 in Lisbon.");
    expect(answer.textContent).not.toContain("Not answered yet.");
    const steps = el.querySelector("[aria-label='What the system did for it']") as HTMLDetailsElement;
    expect(steps.tagName).toBe("DETAILS");
    expect(steps.open).toBe(false);
    expect(steps.querySelector("[data-count]")!.getAttribute("data-count")).toBe("4");
    // Nothing of the walk's own rows is drawn outside the fold.
    const open = [...el.querySelectorAll(".sf-row")].filter((r) => !r.closest("details[aria-label='What the system did for it']"));
    expect(open.map((r) => r.getAttribute("data-row"))).toEqual(["row-answer-1"]);
  });

  test("must-fail: the follow-up looks again on the policy's report floor, not a number of its own", async () => {
    const { qc } = await askHello();
    const q = qc.getQueryCache().find({ queryKey: ["report", JSON.stringify({ type: "record_read", refs_to: ASK_ID })] })!;
    expect(q.observers[0]!.options.refetchInterval).toBe(60_000);
    qc.setQueryData(["renderPolicy"], { tokenOverrides: {}, formByShape: {}, maxPreviewChars: null, ledgerDefaultExpanded: true, revision: 4, updatedAt: 0, note: null, recheck: { reportMinMs: 90_000 } });
    await settle();
    expect(q.observers[0]!.options.refetchInterval).toBe(90_000);
  });
});
