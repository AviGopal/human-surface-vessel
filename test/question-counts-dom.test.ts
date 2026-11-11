/**
 * The rail's folded lines carry the read's counts over every open question, not the rows that
 * fitted in the slice; and an entry that drew nothing says why in the producer's words.
 *
 * Shapes: one node 11-11. The rail said "No reader 16" while the read counted 282 open questions
 * naming no listed reader (248 more were not in the 50-row slice), and "Waiting on you" said
 * "answered with no rows".
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://surface.test/" });

import { afterAll, describe, expect, test } from "bun:test";
import { teardownDom, trackRoot } from "./setup.ts";
import { DEFAULT_VIEWS } from "../src/ui-views.ts";

const CLASSES = { ask: 0, notice: 33, settled: 0, unread: 282, malformed: 1 };
const EMPTY = "None. 282 open questions name no reader this node serves.";
const notice = (i: number) => ({ id: `n-${i}`, revision: 1, title: "Run finished", body: "Nothing to decide.", kind: "notice", createdAt: 0, updatedAt: 0, responses: [], answered: false, declined: false, rank: i + 1 });
const unread = (i: number) => ({ ...notice(i), id: `u-${i}`, kind: "gap_landed_close_proposal", title: "Recommit a fix", body: "Gap g failed.", readerListed: false, rank: 10 + i });

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
  if (url.includes("/api/questions")) {
    return Response.json({ resolved: true, success: true, body: { questions: [notice(0), notice(1), unread(0)], classes: CLASSES } });
  }
  if (url.endsWith("/api/discovery/resolve") && (body["pointer"] as Record<string, unknown>)["type"] === "uiQuestion") {
    return Response.json({ resolved: true, success: true, body: { questions: [], classes: CLASSES, empty_reason: EMPTY } });
  }
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
const { QuestionsList } = await import("../ui/src/components/QuestionsList");
const { Entries } = await import("../ui/src/components/Reports");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterAll(async () => {
  await teardownDom();
});

const settle = async () => {
  for (let i = 0; i < 4; i++) await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
};

async function draw(child: unknown): Promise<HTMLElement> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    createRoot(el).render(React.createElement(QueryClientProvider, { client: qc }, React.createElement(LiveControlsProvider, null, React.createElement(QuestionsProvider, null, child))));
  });
  await settle();
  return el;
}

describe("counts and empty reasons come from the read", () => {
  test("must-fail: a folded line counts every open question of its class, and says how many this page holds", async () => {
    const el = await draw(React.createElement(QuestionsList, { selectedId: null, onSelect: () => {} }));
    const heads = [...el.querySelectorAll(".sf-qgroup-head")].map((h) => h.textContent);
    expect(heads).toEqual(["Notices33", "No reader282", "Malformed1"]);
    const notes = [...el.querySelectorAll(".sf-qgroup-note")].map((n) => n.textContent);
    expect(notes).toEqual(["2 of them in this page of questions", "1 of them in this page of questions", "none of them in this page of questions"]);
  });

  test("must-fail: an entry that drew no rows gives the producer's reason, not a stock phrase", async () => {
    const { pointer, form, field, title } = DEFAULT_VIEWS.landing.entries[0]!;
    const el = await draw(React.createElement(Entries, { entries: [{ pointer, form, field, title }], enabled: true, intervalMs: 60_000, onOpenQuestion: () => {} }));
    expect(el.textContent).toContain(EMPTY);
    expect(el.textContent).not.toContain("answered with no rows");
  });

  test("must-fail: a view's own empty words come first in plain words, the producer's reason folded under why", async () => {
    const waiting = DEFAULT_VIEWS.landing.entries[0]!;
    const el = await draw(React.createElement(Entries, { entries: [waiting], enabled: true, intervalMs: 60_000, onOpenQuestion: () => {} }));
    const note = el.querySelector("[data-report] > .sf-report-note")!;
    expect(note.textContent).toBe("Nothing is waiting on you.");
    const why = el.querySelector("details[data-empty-reason]")!;
    expect(why.hasAttribute("open")).toBe(false);
    expect(why.querySelector("summary")!.textContent).toBe("why");
    expect(why.textContent).toContain(EMPTY);
  });
});
