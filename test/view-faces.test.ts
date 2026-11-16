/**
 * A view names the face a row's words are drawn in by the row's role (the USER 11-16: by role,
 * "something that is alterable by the system"): a person's words in the serif, the system's prose
 * in the sans, a detector's or records' rows in the mono of a record. The mapping is the view's, so
 * a walk changes it with a write like any other, and a write that changes only the faces is a new
 * revision. A role the view does not name draws in the page's face, never the serif, which says a
 * person wrote it.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://surface.test/" });

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { forgetViews, teardownDom, trackRoot } from "./setup.ts";
import { REGISTRATION_PAYLOAD } from "../src/discovery-registration.ts";
import { DEFAULT_FACES, FACES, currentView, undoView, writeView } from "../src/ui-views.ts";

const ENTRIES = [{ pointer: { type: "record_read", shape: "answer" }, form: "rows" }];

describe("the write", () => {
  // The views file, not only the cache: a file run earlier in the same process (the pull-sync gate
  // runs the whole suite in one) can leave a view stored, and the revisions below count from none.
  beforeEach(forgetViews);

  test("must-fail: a view written without faces draws the default, and the default names a person's words serif", () => {
    const got = writeView({ region: "landing", entries: ENTRIES }, null);
    expect(got.ok ? got.view.faces : null).toEqual(DEFAULT_FACES);
    expect(DEFAULT_FACES["person"]).toBe("serif");
    expect(currentView("landing").faces).toEqual(DEFAULT_FACES);
  });

  test("must-fail: a write that changes only the faces is a new revision, and undo restores the faces before it", () => {
    expect(writeView({ region: "landing", entries: ENTRIES }, null)).toMatchObject({ ok: true });
    const changed = writeView({ region: "landing", entries: ENTRIES, faces: { person: "sans", walk: "serif" } }, null);
    expect(changed).toMatchObject({ ok: true, view: { revision: 2, faces: { person: "sans", walk: "serif" } } });
    expect("unchanged" in changed).toBe(false);
    expect(undoView("landing", null)).toMatchObject({ ok: true, view: { faces: DEFAULT_FACES } });
    // Undo restores the faces of the view before, not the default.
    writeView({ region: "landing", entries: ENTRIES, faces: { person: "mono" } }, null);
    writeView({ region: "landing", entries: ENTRIES, faces: { person: "sans" } }, null);
    expect(undoView("landing", null)).toMatchObject({ ok: true, view: { faces: { person: "mono" } } });
  });

  test("must-fail: a write without faces keeps the faces in force, so changing entries does not undo a faces change", () => {
    writeView({ region: "landing", entries: ENTRIES, faces: { person: "mono" } }, null);
    const more = [...ENTRIES, { pointer: { type: "record_read", shape: "failure" }, form: "rows" }];
    expect(writeView({ region: "landing", entries: more }, null)).toMatchObject({ ok: true, view: { faces: { person: "mono" } } });
    expect(currentView("landing").faces).toEqual({ person: "mono" });
  });

  test("must-fail: faces other than serif, sans and mono, or keyed by anything but a role name, are refused", () => {
    for (const faces of [{ person: "comic" }, { "Person!": "serif" }, {}, ["serif"], "serif"]) {
      const got = writeView({ region: "landing", entries: ENTRIES, faces }, null);
      expect(got.ok).toBe(false);
      expect(got.ok ? "" : got.detail).toContain("faces:");
    }
  });

  test("must-fail: the faces are declared to discovery with the faces a write accepts", () => {
    const s = (REGISTRATION_PAYLOAD as unknown as { shape_inputs: Record<string, { properties: Record<string, { additionalProperties: { enum: string[] } }> }> }).shape_inputs["uiView_write"]!;
    expect(s.properties["faces"]!.additionalProperties.enum).toEqual([...FACES]);
  });
});

const ROWS = [
  { shape: "answer", role: "person", text: "Asked by a person.", t: "2026-11-16T09:00:00.000Z", seq: 1, id: "1".repeat(64) },
  { shape: "answer", role: "walk", text: "Said by the walk.", t: "2026-11-16T09:01:00.000Z", seq: 2, id: "2".repeat(64) },
  { shape: "answer", role: "newcomer", text: "A role no view names.", t: "2026-11-16T09:02:00.000Z", seq: 3, id: "3".repeat(64) },
  { shape: "answer", text: "No role at all.", n: 4, t: "2026-11-16T09:03:00.000Z", seq: 4, id: "4".repeat(64) },
];
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.includes("/api/discovery/resolve")) {
    const pointer = JSON.parse(String(init?.body)).pointer as Record<string, unknown>;
    return Response.json(pointer["shape"] === "answer" ? ROWS : []);
  }
  if (url.includes("/api/questions")) return Response.json({ resolved: true, success: true, body: { questions: [] } });
  return Response.json({});
}) as typeof fetch;

const uiSrc = new URL("../ui/src/", import.meta.url).pathname;
const React = await import(Bun.resolveSync("react", uiSrc));
const { createRoot: rawCreateRoot } = await import(Bun.resolveSync("react-dom/client", uiSrc));
const createRoot = (...a: Parameters<typeof rawCreateRoot>) => trackRoot(rawCreateRoot(...a));
const { act } = React;
const { QueryClient, QueryClientProvider } = await import(Bun.resolveSync("@tanstack/react-query", uiSrc));
const { LiveControlsProvider } = await import("../ui/src/state/liveControls");
const { QuestionsProvider } = await import("../ui/src/state/questions");
const { Entries } = await import("../ui/src/components/Reports");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterAll(async () => {
  await forgetViews();
  await teardownDom();
});
async function mount(faces: Record<string, string>): Promise<HTMLElement> {
  const el = document.createElement("div");
  document.body.replaceChildren(el);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const entries = [{ pointer: { type: "record_read", shape: "answer" }, form: "rows", words: ["text", "n"] }];
  await act(async () => {
    createRoot(el).render(React.createElement(QueryClientProvider, { client: qc }, React.createElement(LiveControlsProvider, null, React.createElement(QuestionsProvider, null, React.createElement(Entries, { entries, faces, enabled: true, intervalMs: 60_000, onOpenQuestion: () => {} })))));
  });
  for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
  return el;
}
const face = (el: HTMLElement, n: string) => el.querySelector(`.sf-row[data-row="${n.repeat(64)}"]`)!.getAttribute("data-face");

describe("the page", () => {
  test("must-fail: each row takes the face its view names for its role; a role not named, or none, takes none", async () => {
    const el = await mount({ ...DEFAULT_FACES });
    expect([face(el, "1"), face(el, "2"), face(el, "3"), face(el, "4")]).toEqual(["serif", "sans", null, null]);
  });

  test("must-fail: the view's faces are what the page draws, so a walk's change of them is drawn", async () => {
    const el = await mount({ person: "mono", walk: "serif" });
    expect([face(el, "1"), face(el, "2")]).toEqual(["mono", "serif"]);
  });

  test("a value drawn with its field's name is marked a record line; prose is not", async () => {
    const el = await mount({ ...DEFAULT_FACES });
    const row4 = el.querySelector(`.sf-row[data-row="${"4".repeat(64)}"]`)!;
    expect(row4.querySelector(".sf-row-words[data-field-line]")!.textContent).toBe("n 4");
    expect(el.querySelector(`.sf-row[data-row="${"1".repeat(64)}"] .sf-row-words[data-field-line]`)).toBeNull();
  });
});
