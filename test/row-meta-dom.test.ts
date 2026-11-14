/**
 * A row's time, its details and the person's verdict are one line under the row's words, so a
 * reply takes one line of chrome, not three; what opens (the details, the system's own grade)
 * takes the full width under that line, and the system's grade stays outside the verdict group.
 * The line's layout is measured on the rendered page; this pins the structure it lays out.
 *
 * Shape: one node 11-11. Each reply on the landing stacked its time, "details" and Right/Wrong
 * on three lines (about 150px), so two asks filled a 1080px screen; the USER: "The view does not
 * fit well within the available area."
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://surface.test/" });

import { afterAll, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import { teardownDom, trackRoot } from "./setup.ts";
import { DEFAULT_VIEWS } from "../src/ui-views.ts";

const ANSWER = { input_refs: ["d14cd850"], text: "What would you like to narrow it to?", shape: "answer", seq: 5411, t: "2026-11-11T13:34:30.000Z", writer: "described-shape-vessel", role: "described", id: "d0097dae" };
const SYSTEM = { input_refs: ["d14cd850", "d0097dae"], r: 0, shape: "outcome", seq: 5415, t: "2026-11-11T13:34:36.023Z", writer: "described-shape-vessel", role: "described", id: "a466cb53" };
const PERSON = { input_refs: ["d0097dae"], r: 1, shape: "outcome", seq: 5500, t: "2026-11-11T14:00:00.000Z", writer: "key_person_1", role: "person", id: "b0b0b0b0" };
const RECORDS = [ANSWER, SYSTEM, PERSON];

/** records' read: shape, refs_to and `where` by equality, as records-vessel serves it. */
function read(p: Record<string, unknown>): unknown[] {
  const where = (p["where"] ?? {}) as Record<string, unknown>;
  return RECORDS.filter(
    (r) =>
      (p["shape"] === undefined || r.shape === p["shape"]) &&
      (p["refs_to"] === undefined || r.input_refs.includes(String(p["refs_to"]))) &&
      Object.entries(where).every(([k, v]) => String((r as Record<string, unknown>)[k]) === String(v)),
  );
}

const sent: Record<string, unknown>[] = [];
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.endsWith("/api/session")) return Response.json({ available: false, keySignIn: true, signedIn: true, person: { userId: "key_person_1", name: null, email: null, expiresAt: Date.now() + 900_000 } });
  if (url.includes("/api/discovery/resolve")) {
    const pointer = JSON.parse(String(init?.body)).pointer as Record<string, unknown>;
    sent.push(pointer);
    if (pointer["type"] === "record_read") return Response.json(pointer["shape"] === "answer" ? [ANSWER] : read(pointer));
    if (pointer["type"] === "record_write") return Response.json({ ok: true, seq: 5600, id: "row-5600" });
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
  setSystemTime();
  await teardownDom();
});
beforeEach(() => {
  sent.length = 0;
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
const button = (row: Element, text: string) => [...row.querySelectorAll("button")].find((b) => b.textContent === text) as HTMLButtonElement;
const row = (el: HTMLElement) => el.querySelector(`.sf-row[data-row="${ANSWER.id}"]`)!;
// The folded "What the walk answered" entry of the default landing, unfolded.
const answered = { ...DEFAULT_VIEWS.landing.entries.find((e) => e.title === "What the walk answered")!, folded: undefined };

describe("a row's time, details and verdict share one line", () => {
  test("must-fail: the time, the details and the verdict group are children of one line", async () => {
    const el = await mount([answered]);
    const meta = [...row(el).children].find((c) => c.classList.contains("sf-row-meta"))!;
    expect(meta).toBeDefined();
    expect([...meta.children].map((c) => c.className.split(" ").find((n) => n.startsWith("sf-row-")))).toEqual(["sf-row-time", "sf-row-details", "sf-row-judge"]);
    expect([...meta.children].some((c) => c.getAttribute("role") === "group")).toBe(true);
  });

  test("must-fail: the time on that line is an age, the exact instant with its zone on hover", async () => {
    setSystemTime(new Date("2026-11-11T13:46:30.000Z"));
    const el = await mount([answered]);
    setSystemTime();
    const time = row(el).querySelector(".sf-row-time")!;
    expect(time.tagName).toBe("TIME");
    expect(time.textContent).toBe("12m ago");
    expect(time.getAttribute("dateTime")).toBe(ANSWER.t);
    expect(time.getAttribute("title")).toMatch(/2026.*(\d:\d\d|[AP]M) (UTC|GMT([+-]\d{1,2}(:\d\d)?)?|[A-Z]{3,5})$/);
  });

  test("must-fail: after a verdict the system's grade joins that line, outside the verdict group", async () => {
    const el = await mount([answered]);
    await act(async () => button(row(el), "Right").click());
    await settle();
    const fold = row(el).querySelector("details[data-system-grade]")!;
    expect(fold.parentElement!.classList.contains("sf-row-meta")).toBe(true);
    expect(fold.closest('[role="group"]')).toBeNull();
  });

  test("the row's words stay above that line", async () => {
    const el = await mount([answered]);
    const kids = [...row(el).children].map((c) => c.className.split(" ")[0]);
    expect(kids.indexOf("sf-row-words")).toBeLessThan(kids.indexOf("sf-row-meta"));
  });
});
