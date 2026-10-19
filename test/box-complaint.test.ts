/**
 * A complaint about the interface is typed in the one box (16f-3): a message that
 * STARTS with "hard to see:", "hard to understand:" or "wrong:" files the same
 * human_reported gap the form filed, about what is on screen (the open question on
 * the questions page, otherwise the surface). The form is gone; chips in the
 * Issues drawer and on the questions page fill the box and never send.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://surface.test/" });

import { afterAll, beforeEach, describe, expect, test } from "bun:test";

const calls: { url: string; body: Record<string, unknown> }[] = [];
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
  } catch {
    /* not json */
  }
  calls.push({ url, body });
  if (url.includes("/api/feedback")) return new Response(JSON.stringify({ resolved: true, body: { filed_gap_id: "ui-feedback-x" } }), { status: 200 });
  if (url.includes("/api/surface-intent")) return new Response(JSON.stringify({ applied: false, unparsed: [] }), { status: 422 });
  if (url.includes("/api/run-goal")) return new Response(JSON.stringify({ accepted: true, dispatchId: "d-new" }), { status: 202 });
  if (url.includes("/api/questions")) return new Response(JSON.stringify({ resolved: true, success: true, body: { questions: [] } }), { status: 200 });
  return new Response(JSON.stringify({ resolved: true, success: true, body: {} }), { status: 200 });
}) as typeof fetch;

const uiSrc = new URL("../ui/src/", import.meta.url).pathname;
const React = await import(Bun.resolveSync("react", uiSrc));
const { createRoot } = await import(Bun.resolveSync("react-dom/client", uiSrc));
const { act } = React;
const { QueryClient, QueryClientProvider } = await import(Bun.resolveSync("@tanstack/react-query", uiSrc));
const { LiveControlsProvider } = await import("../ui/src/state/liveControls");
const { QuestionsProvider } = await import("../ui/src/state/questions");
const { TopBar } = await import("../ui/src/components/TopBar");
const { IssuesDrawer } = await import("../ui/src/components/IssuesDrawer");
const box = await import("../ui/src/lib/box");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: { unmount: () => void }[] = [];
afterAll(async () => {
  await act(async () => {
    for (const r of roots) r.unmount();
  });
  await GlobalRegistrator.unregister();
});
beforeEach(() => {
  calls.length = 0;
});

const question = {
  id: "solicitation-s-1", revision: 1, title: "Where should it look?", body: "## Where should it look?", createdAt: 0, updatedAt: 0,
  responses: [], answered: false, declined: false, run: { dispatchId: "d-run", solicitationId: "s-1", deadlineAt: null, linked: true },
} as never;

async function mount(node: unknown): Promise<HTMLElement> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const root = createRoot(el);
  roots.push(root);
  await act(async () => {
    root.render(React.createElement(QueryClientProvider, { client: qc }, React.createElement(LiveControlsProvider, null, React.createElement(QuestionsProvider, null, node))));
  });
  return el;
}
const topBar = (props: Record<string, unknown> = {}) =>
  React.createElement(TopBar, { onDispatched: () => {}, openIssues: null, onToggleIssues: () => {}, issuesOpen: false, ...props });

async function type(el: HTMLElement, text: string): Promise<void> {
  const t = el.querySelector("textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!.call(t, text);
    t.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    t.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  for (let i = 0; i < 3; i++) await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
}
const filed = () => calls.filter((c) => c.url.includes("/api/feedback"));

describe("readComplaint", () => {
  test("only an exact prefix at the start, with something after the colon", () => {
    expect(box.readComplaint("hard to understand: the dates are unreadable")).toEqual({ kind: "hard_to_understand", text: "the dates are unreadable" });
    expect(box.readComplaint("Hard to see:  grey on grey")).toEqual({ kind: "hard_to_see", text: "grey on grey" });
    expect(box.readComplaint("WRONG: it says reached")).toEqual({ kind: "wrong", text: "it says reached" });
    for (const not of ["this is hard to understand", "wrong answer", "Wrong: ", "the dates — hard to see: everything", "hard to read: x", "wrong it says reached"]) {
      expect([not, box.readComplaint(not)]).toEqual([not, null]);
    }
  });
});

describe("the box files a complaint", () => {
  test("must-fail: a prefixed message files the human_reported gap about the surface, and starts nothing", async () => {
    const el = await mount(topBar());
    await type(el, "hard to understand: the dates are unreadable");
    expect(filed().map((c) => c.body)).toEqual([{ panel_id: "the surface", kind: "hard_to_understand", value: "the dates are unreadable" }]);
    expect(calls.some((c) => c.url.includes("/api/run-goal") || c.url.includes("/api/surface-intent"))).toBe(false);
    expect(el.querySelector(".sf-outcome-line")?.textContent).toBe("Interface issue×");
  });

  test("must-fail: with a run waiting, a complaint is a complaint, not the answer", async () => {
    const el = await mount(topBar({ context: box.boxContext(question, "Where should it look?", null) }));
    await type(el, "wrong: the question makes no sense");
    expect(filed().map((c) => c.body["kind"])).toEqual(["wrong"]);
    expect(calls.some((c) => c.body["type"] === "solicitationResponse_write" || c.url.includes("/api/participation"))).toBe(false);
  });

  test("must-fail: on the questions page, the complaint is about the open question, and the act is reported", async () => {
    const el = await mount(topBar({ complaintRegion: "solicitation-s-9" }));
    await type(el, "hard to see: the options run together");
    expect(filed()[0]?.body).toEqual({ panel_id: "solicitation-s-9", kind: "hard_to_see", value: "the options run together" });
    const act = calls.find((c) => c.url.includes("/api/observations") && c.body["outcome"] === "complained");
    expect(act?.body).toMatchObject({ obs_type: "exposure_outcome", panel_id: "solicitation-s-9" });
  });

  test("anything else is not a complaint", async () => {
    const el = await mount(topBar());
    await type(el, "the dates — hard to see: everything");
    expect(filed()).toEqual([]);
    expect(calls.some((c) => c.url.includes("/api/run-goal"))).toBe(true);
  });
});

describe("the form is gone; chips fill the box", () => {
  test("must-fail: the Issues drawer has no complaint form, and its chips fill the box and send nothing", async () => {
    const el = await mount(React.createElement(React.Fragment, null, topBar(), React.createElement(IssuesDrawer, { onClose: () => {} })));
    for (let i = 0; i < 3; i++) await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect([...el.querySelectorAll("button")].map((b) => b.textContent)).not.toContain("Report a problem");
    expect(el.querySelector(".sf-complain")).toBeNull();
    const chips = [...el.querySelectorAll(".sf-complaint-chips button")];
    expect(chips.map((b) => b.textContent)).toEqual(["hard to see:", "hard to understand:", "wrong:"]);
    calls.length = 0;
    await act(async () => {
      (chips[1] as HTMLButtonElement).click();
    });
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(el.querySelector("textarea")?.value).toBe("hard to understand: ");
    expect(filed()).toEqual([]);
  });
});
