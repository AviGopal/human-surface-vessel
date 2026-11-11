/**
 * After an ask is written, the box follows it: the rows that cite it, read from records by the
 * ask's own id, drawn as any view entry is. Before anything cites it, the page says so in plain
 * words, so a quiet page is never read as work under way.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://surface.test/" });

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { teardownDom, trackRoot } from "./setup.ts";

const ASK_ID = "row-ask-2434";
let citing: Record<string, unknown>[] = [];
const reads: Record<string, unknown>[] = [];
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
  const person = { userId: "user:person-a", name: "Person A", expiresAt: Date.now() + 900_000 };
  if (url.endsWith("/api/session")) return Response.json({ keySignIn: true, signedIn: true, person });
  if (url.endsWith("/api/surface-intent")) return new Response("{}", { status: 422 });
  if (url.endsWith("/api/discovery/resolve")) {
    const pointer = body["pointer"] as Record<string, unknown>;
    if (pointer["type"] === "record_write") return Response.json({ resolved: true, success: true, body: { ...(pointer["row"] as object), seq: 2434, id: ASK_ID } });
    reads.push(pointer);
    return Response.json({ resolved: true, success: true, body: citing });
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
  test("must-fail: the follow-up reads the rows citing the ask by its own id, and says so when there are none", async () => {
    const { el } = await askHello();
    expect(el.textContent).toContain("Asked (record #2434).");
    expect(reads).toContainEqual({ type: "record_read", refs_to: ASK_ID });
    expect(el.querySelector("[aria-label='What cites #2434']")?.textContent).toContain("No row cites #2434 yet.");
  });

  test("must-fail: a row citing the ask is drawn under it", async () => {
    citing = [{ shape: "answer", id: "row-answer-1", text: "It is 08:10 in Lisbon.", input_refs: [ASK_ID] }];
    const { el } = await askHello();
    const follow = el.querySelector("[aria-label='What cites #2434']")!;
    expect(follow.textContent).toContain("It is 08:10 in Lisbon.");
    expect(follow.textContent).not.toContain("No row cites");
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
