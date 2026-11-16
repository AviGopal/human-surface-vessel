/**
 * The whole page, mounted through its router: with a view written for the landing,
 * the first screen draws that view's entries in order. Nothing here imports the
 * landing component, so at a build without views it fails on what the page draws.
 * No run is drawn and no goal-host shape is read. There is no questions rail: a question
 * waiting on the person opens in place on the landing, so what is being worked on stays in view.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://surface.test/" });

import { afterAll, describe, expect, test } from "bun:test";
import { teardownDom, trackRoot } from "./setup.ts";

const decision = {
  id: "q1", revision: 1, title: "Question", body: "Gap reach-gap-docs-align-tick (unreachable_producer) has failed auto-repair 8+ times. Summary: docs align",
  createdAt: 0, updatedAt: 0, responses: [], answers: [], answered: false, declined: false, kind: "gap_needs_human",
};
// Held by the surface but not waiting on the person, so not among the landing's waiting rows.
const linked = { ...decision, id: "q-linked", body: "Should the docs loop keep its weekly rhythm?", kind: "notice" };
const goalHostReads: string[] = [];
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.includes("/api/ui-view")) {
    return Response.json({ region: "landing", revision: 4, id: "landing@4", notDrawn: null, entries: [
      { pointer: { type: "system_load_report" }, form: "fields" },
      { pointer: { type: "uiQuestion", open: true }, form: "questions", field: "questions", title: "Waiting on you" },
    ] });
  }
  if (url.includes("/api/discovery/resolve")) {
    const pointer = JSON.parse(String(init?.body)).pointer as { type: string };
    if (pointer.type === "uiQuestion") return Response.json({ success: true, shape: "uiQuestion", body: { questions: [decision] } });
    return Response.json({ success: true, shape: "systemLoadReport", body: { load_avg_1m: 2.61, cpu_cores: 16 } });
  }
  if (url.includes("/api/questions")) return Response.json({ resolved: true, success: true, body: { questions: [decision, linked] } });
  if (url.includes("/api/resolve")) goalHostReads.push(JSON.parse(String(init?.body ?? "{}")).type);
  return Response.json({});
}) as typeof fetch;

const uiSrc = new URL("../ui/src/", import.meta.url).pathname;
const React = await import(Bun.resolveSync("react", uiSrc));
const { createRoot: rawCreateRoot } = await import(Bun.resolveSync("react-dom/client", uiSrc));
const createRoot = (...a: Parameters<typeof rawCreateRoot>) => trackRoot(rawCreateRoot(...a));
const { act } = React;
const { QueryClient, QueryClientProvider } = await import(Bun.resolveSync("@tanstack/react-query", uiSrc));
const { RouterProvider } = await import(Bun.resolveSync("@tanstack/react-router", uiSrc));
const { LiveControlsProvider } = await import("../ui/src/state/liveControls");
const { router } = await import("../ui/src/router");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterAll(async () => {
  await teardownDom();
});

describe("the first screen follows the landing's view", () => {
  test("must-fail: the view's entries are drawn in its order, not the newest run", async () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => {
      createRoot(el).render(React.createElement(QueryClientProvider, { client: qc }, React.createElement(LiveControlsProvider, null, React.createElement(RouterProvider, { router }))));
    });
    for (let i = 0; i < 8; i++) await act(async () => { await new Promise((r) => setTimeout(r, 40)); });
    const main = el.querySelector("main")!;
    const entries = [...main.querySelectorAll("[data-report]")].map((b) => b.getAttribute("data-report"));
    expect(entries).toEqual(["system_load_report", "uiQuestion"]);
    expect(main.querySelector("[data-view-record]")!.textContent).toContain("landing@4");
    expect(main.querySelector("[data-report=uiQuestion]")?.textContent).toContain("Waiting on you");
    expect(main.querySelector("[data-report=uiQuestion] button")?.textContent).toContain("Reach gap docs align tick");
    expect(main.querySelector("[data-report=system_load_report]")?.textContent).toContain("2.61");
    expect(main.querySelector(".sf-run")).toBeNull();
    expect(goalHostReads.filter((t) => /^goalWalk/.test(t))).toEqual([]);
  });

  test("must-fail: there is no questions rail; what waits on the person is the landing's", async () => {
    expect(document.querySelector("nav.sf-rail, [aria-label=Questions]")).toBeNull();
    expect(document.body.textContent).not.toContain("Nothing would read your answer");
  });

  test("must-fail: a question opens in place, under its row, with the rest of the landing still drawn; opening it again closes it", async () => {
    const main = document.querySelector("main")!;
    const row = main.querySelector("[data-report=uiQuestion] button.sf-landing-row") as HTMLButtonElement;
    expect(row.getAttribute("aria-expanded")).toBe("false");
    await act(async () => { row.click(); });
    for (let i = 0; i < 5; i++) await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(router.state.location.pathname).toBe("/question/q1");
    const open = main.querySelector("[data-report=uiQuestion] li [data-question-open=q1] article.sf-question");
    expect(open).not.toBeNull();
    expect(open!.textContent).toContain("docs align");
    // Its row names it: the question under it carries no heading of its own.
    expect(open!.querySelector("h2")).toBeNull();
    expect(open!.getAttribute("aria-label")).toBe("Reach gap docs align tick");
    expect(main.querySelector("[data-report=system_load_report]")?.textContent).toContain("2.61");
    expect(main.querySelectorAll("[data-question-open]")).toHaveLength(1);
    const again = main.querySelector("[data-report=uiQuestion] button.sf-landing-row") as HTMLButtonElement;
    expect(again.getAttribute("aria-expanded")).toBe("true");
    await act(async () => { again.click(); });
    for (let i = 0; i < 5; i++) await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(router.state.location.pathname).toBe("/");
    expect(main.querySelector("[data-question-open]")).toBeNull();
  });

  test("must-fail: a question opened by a link that is not a waiting row opens above the list, the landing still drawn", async () => {
    await act(async () => { void router.navigate({ to: "/question/$questionId", params: { questionId: "q-linked" } }); });
    for (let i = 0; i < 5; i++) await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    const main = document.querySelector("main")!;
    const open = main.querySelector("[data-report=uiQuestion] [data-question-open=q-linked] article.sf-question");
    expect(open?.textContent).toContain("weekly rhythm");
    // No row names it here, so it keeps its heading.
    expect(open?.querySelector("h2")).not.toBeNull();
    expect(main.querySelectorAll("[data-question-open]")).toHaveLength(1);
    expect(main.querySelector("[data-report=system_load_report]")).not.toBeNull();
    await act(async () => { void router.navigate({ to: "/" }); });
    for (let i = 0; i < 3; i++) await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
  });

  test("a waiting row is measured for exposure, as the rail's rows were", () => {
    const row = document.querySelector("[data-report=uiQuestion] button.sf-landing-row")!;
    expect(row.getAttribute("data-solicitation-id")).toBe("q1");
    expect(row.getAttribute("data-exposure-role")).toBe("list_row");
    expect(row.getAttribute("data-form-shape")).toBe("human_question");
  });
});
