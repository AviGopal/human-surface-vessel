/**
 * An output cut at goal-host's 2,000-character preview can be drawn whole: the
 * surface reads it by run and pool id through the goalWalkOutput shape, for a
 * signed-in person only (qa ruling 10-24). A page (the person asked to see the
 * page) is read whole at once; any other cut output offers "Show all". Signed
 * out, or where the whole cannot be read, the preview stays, marked.
 *
 * Shapes: one node 10-20, a page drawn from the first 2,000 of 48,907 chars; the
 * shape is goal-host's {dispatchId, impulseId} → {content, chars, truncated, ...}.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://surface.test/" });

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { teardownDom, trackRoot } from "./setup.ts";

const WHOLE_PAGE = `<html><body>${"<p>paragraph</p>".repeat(400)}<footer>the end</footer></body></html>`;
const WHOLE_TEXT = `line one\n${"more text ".repeat(400)}\nthe last line`;
let wholeAvailable = true;
let signedIn = true;
const reads: Record<string, unknown>[] = [];
const framePosts: string[] = [];
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  const body = (() => {
    try {
      return JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    } catch {
      return {};
    }
  })();
  if (url.endsWith("/api/session")) return Response.json({ available: true, signedIn, ...(signedIn ? { person: { userId: "user:alex", name: "Alex", email: null, expiresAt: Date.now() + 900_000 } } : {}) });
  if (url.includes("/api/walk-output?")) {
    const q = new URL(url, "http://surface.test").searchParams;
    const read = { type: "goalWalkOutput", dispatchId: q.get("dispatch_id"), impulseId: q.get("impulse_id") };
    reads.push(read);
    if (!signedIn) return Response.json({ error: "sign in to read full outputs" }, { status: 401 });
    if (!wholeAvailable) return Response.json({ resolved: false, error: "output not found" }, { status: 404 });
    const content = read.impulseId === "imp-page" ? WHOLE_PAGE : WHOLE_TEXT;
    return Response.json({ resolved: true, shape: "goalWalkOutput", body: { dispatchId: read.dispatchId, impulseId: read.impulseId, contentType: "text", content, chars: content.length, truncated: false } });
  }
  if (url.endsWith("/api/page-frame") && init?.method === "POST") {
    framePosts.push(String(body["source"]));
    return Response.json({ id: "a".repeat(64) });
  }
  if (url.endsWith("/api/render-policy")) {
    return Response.json({ tokenOverrides: {}, formByShape: {}, learnedFormByShape: { http_fetch: "page" }, maxPreviewChars: null, ledgerDefaultExpanded: true, revision: 1, updatedAt: 0, note: null });
  }
  return new Response("{}", { status: 200 });
}) as typeof fetch;

const uiSrc = new URL("../ui/src/", import.meta.url).pathname;
const React = await import(Bun.resolveSync("react", uiSrc));
const { createRoot: rawCreateRoot } = await import(Bun.resolveSync("react-dom/client", uiSrc));
const createRoot = (...a: Parameters<typeof rawCreateRoot>) => trackRoot(rawCreateRoot(...a));
const { act } = React;
const { QueryClient, QueryClientProvider } = await import(Bun.resolveSync("@tanstack/react-query", uiSrc));
const { LiveControlsProvider } = await import("../ui/src/state/liveControls");
const { Rendered } = await import("../ui/src/components/Rendered");
const { fromProvenance } = await import("../ui/src/lib/content");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterAll(async () => {
  await teardownDom();
});
beforeEach(() => {
  wholeAvailable = true;
  signedIn = true;
  reads.length = 0;
  framePosts.length = 0;
});

const settle = async () => {
  for (let i = 0; i < 5; i++) await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
};

async function mount(node: unknown): Promise<HTMLElement> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    createRoot(el).render(React.createElement(QueryClientProvider, { client: qc }, React.createElement(LiveControlsProvider, null, node as never)));
  });
  await settle();
  return el;
}

const cut = (id: string, shape: string, whole: string) =>
  fromProvenance({ id, shape, producedBy: "satisfier:x", contentPreview: whole.slice(0, 2000), chars: whole.length, truncated: true }, null, null, "d-run")!;

describe("drawing a cut output whole", () => {
  test("must-fail: a page is read whole by run and pool id, and drawn without the cut mark", async () => {
    const el = await mount(React.createElement(Rendered, { content: cut("imp-page", "http_fetch", WHOLE_PAGE), density: "full" }));
    expect(reads).toEqual([{ type: "goalWalkOutput", dispatchId: "d-run", impulseId: "imp-page" }]);
    expect(framePosts.at(-1)).toBe(WHOLE_PAGE);
    expect(el.querySelector(".sf-page-cut")).toBeNull();
    expect(el.querySelector(".sf-rendered")?.getAttribute("data-state")).toBe("full");
  });

  test("must-fail: another cut output offers Show all, and draws whole when asked", async () => {
    const el = await mount(React.createElement(Rendered, { content: cut("imp-text", "llm_completion_result", WHOLE_TEXT), density: "full" }));
    expect(reads).toEqual([]);
    const show = [...el.querySelectorAll("button")].find((b) => b.textContent === "Show all") as HTMLButtonElement | undefined;
    expect(show).toBeDefined();
    await act(async () => show!.click());
    await settle();
    expect(reads).toEqual([{ type: "goalWalkOutput", dispatchId: "d-run", impulseId: "imp-text" }]);
    expect(el.textContent).toContain("the last line");
    expect(el.querySelector(".sf-cut")).toBeNull();
    expect([...el.querySelectorAll("button")].some((b) => b.textContent === "Show all")).toBe(false);
  });

  test("where the whole cannot be read, the preview stays and says it is cut", async () => {
    wholeAvailable = false;
    const el = await mount(React.createElement(Rendered, { content: cut("imp-page", "http_fetch", WHOLE_PAGE), density: "full" }));
    expect(reads.length).toBe(1);
    expect(framePosts.at(-1)).toBe(WHOLE_PAGE.slice(0, 2000));
    expect(el.querySelector(".sf-page-cut")?.textContent).toBe(`Cut off: the first 2,000 of ${WHOLE_PAGE.length.toLocaleString("en-US")} characters`);
  });

  test("must-fail: signed out, nothing is read; the page keeps its marked preview and nothing offers Show all", async () => {
    signedIn = false;
    const page = await mount(React.createElement(Rendered, { content: cut("imp-page", "http_fetch", WHOLE_PAGE), density: "full" }));
    const text = await mount(React.createElement(Rendered, { content: cut("imp-text", "llm_completion_result", WHOLE_TEXT), density: "full" }));
    expect(reads).toEqual([]);
    expect(framePosts.at(-1)).toBe(WHOLE_PAGE.slice(0, 2000));
    expect(page.querySelector(".sf-page-cut")).not.toBeNull();
    expect([...page.querySelectorAll("button"), ...text.querySelectorAll("button")].some((b) => b.textContent === "Show all")).toBe(false);
  });

  test("an output that arrived whole is never read again, and one with no run id offers nothing", async () => {
    const whole = fromProvenance({ id: "imp-small", shape: "llm_completion_result", contentPreview: "short", chars: 5, truncated: false }, null, null, "d-run")!;
    const el1 = await mount(React.createElement(Rendered, { content: whole, density: "full" }));
    const noRun = fromProvenance({ id: "imp-x", shape: "llm_completion_result", contentPreview: WHOLE_TEXT.slice(0, 2000), chars: WHOLE_TEXT.length, truncated: true })!;
    const el2 = await mount(React.createElement(Rendered, { content: noRun, density: "full" }));
    expect(reads).toEqual([]);
    expect([...el1.querySelectorAll("button"), ...el2.querySelectorAll("button")].some((b) => b.textContent === "Show all")).toBe(false);
  });
});
