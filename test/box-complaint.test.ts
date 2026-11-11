/**
 * A complaint about the interface is typed in the one box (16f-3): a message that
 * STARTS with "hard to see:", "hard to understand:" or "wrong:" is written as the
 * person's row, `world_changed` in their own words, where an ask goes, naming the open
 * question when there is one. It is never filed by the surface itself. The form is gone;
 * chips in the Issues drawer and on the questions page fill the box and never send.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://surface.test/" });

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { teardownDom, trackRoot } from "./setup.ts";

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
  if (url.includes("/api/surface-intent")) return new Response(JSON.stringify({ applied: false, unparsed: [] }), { status: 422 });
  if (url.includes("/api/discovery/resolve")) return Response.json({ ok: true, seq: 302 });
  if (url.includes("/api/questions")) return new Response(JSON.stringify({ resolved: true, success: true, body: { questions: [] } }), { status: 200 });
  return new Response(JSON.stringify({ resolved: true, success: true, body: {} }), { status: 200 });
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
const { IssuesDrawer } = await import("../ui/src/components/IssuesDrawer");
const box = await import("../ui/src/lib/box");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const roots: { unmount: () => void }[] = [];
afterAll(async () => {
  await teardownDom();
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
  React.createElement(TopBar, { openIssues: null, onToggleIssues: () => {}, issuesOpen: false, ...props });

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
/** The rows the box wrote, through discovery. */
const filed = () => calls.filter((c) => c.url.includes("/api/discovery/resolve")).map((c) => (c.body["pointer"] as { row: Record<string, unknown> }).row);
const fedGap = () => calls.some((c) => c.url.includes("/api/feedback") || JSON.stringify(c.body).includes("uiFeedback"));

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
  test("must-fail: a prefixed message is the person's row in their own words, and nothing else is sent", async () => {
    const el = await mount(topBar());
    await type(el, "hard to understand: the dates are unreadable");
    expect(filed()).toEqual([{ shape: "world_changed", what: "hard to understand: the dates are unreadable", input_refs: [] }]);
    expect(fedGap()).toBe(false);
    expect(calls.some((c) => c.url.includes("/api/surface-intent"))).toBe(false);
    expect(el.querySelector(".sf-outcome-line")?.textContent).toBe("Complaint recorded (record #302).×");
  });

  test("must-fail: signed out, the complaint stays in the box and says how to send it", async () => {
    const el = await mount(topBar());
    const real = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input).includes("/api/discovery/resolve") ? Response.json({ error: "sign_in_required" }, { status: 401 }) : real(input, init)) as typeof fetch;
    try {
      await type(el, "wrong: it says reached");
    } finally {
      globalThis.fetch = real;
    }
    expect(el.querySelector("textarea")?.value).toBe("wrong: it says reached");
    expect(el.textContent).toContain("Not sent yet: sign in with your key, then send it again.");
  });

  test("must-fail: with a run waiting, a complaint is a complaint, not the answer", async () => {
    const el = await mount(topBar({ context: box.boxContext(question, "Where should it look?", null) }));
    await type(el, "wrong: the question makes no sense");
    expect(filed().map((r) => r["what"])).toEqual(["wrong: the question makes no sense"]);
    expect(calls.some((c) => c.body["type"] === "solicitationResponse_write" || c.url.includes("/api/participation"))).toBe(false);
  });

  test("must-fail: on the questions page, the complaint is about the open question, and the act is reported", async () => {
    const el = await mount(topBar({ complaintRegion: "solicitation-s-9" }));
    await type(el, "hard to see: the options run together");
    expect(filed()[0]).toEqual({ shape: "world_changed", what: "hard to see: the options run together (about question solicitation-s-9)", input_refs: [] });
    const act = calls.find((c) => c.url.includes("/api/observations") && c.body["outcome"] === "complained");
    expect(act?.body).toMatchObject({ obs_type: "exposure_outcome", panel_id: "solicitation-s-9" });
  });

  test("anything else is not a complaint", async () => {
    const el = await mount(topBar());
    await type(el, "the dates — hard to see: everything");
    expect(fedGap()).toBe(false);
    expect(calls.find((c) => c.url.includes("/api/discovery/resolve"))?.body).toEqual({ pointer: { type: "record_write", row: { shape: "world_changed", what: "the dates — hard to see: everything", input_refs: [] } } });
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
