/**
 * An output is a person's only by provenance: this surface delivered the run's
 * question and holds the answer, and the walk logged that the answer drove a
 * step, which produced the output. Never by a shape's name (user rulings 10-17).
 * Fixture: a reached run whose human_input a satisfier produced (an empty concept
 * search) and the judge credited, with no question ever asked. It gets no
 * person mark, and its credit line still names the satisfier.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://surface.test/" });

import { afterAll, describe, expect, test } from "bun:test";
import { teardownDom, trackRoot } from "./setup.ts";
import { readFileSync } from "node:fs";

// The fixture keeps only what the page reads from the run; the rest are the serializer's empty defaults.
const walk = {
  pendingTargets: [], poolEvents: [], walkLog: [], currentStep: null, steps: [], walkTier: null, grounded: null,
  operator: "human-surface", humanGraded: false, humanReachNotes: null, trigger: null, requeueOf: null,
  ...(JSON.parse(readFileSync(new URL("./fixtures/fabricated-person-walk.json", import.meta.url), "utf8")) as Record<string, unknown>),
};
const dispatchId = String(walk["dispatchId"]);
let questions: unknown[] = [];
const grades: Record<string, unknown>[] = [];

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.includes("/api/questions")) return new Response(JSON.stringify({ resolved: true, success: true, body: { questions } }), { status: 200 });
  if (url.includes("/api/verdicts")) return new Response(JSON.stringify({ body: { verdicts: [] } }), { status: 200 });
  if (url.includes("/api/grade")) {
    grades.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
    return new Response("{}", { status: 200 });
  }
  if (url.includes("/api/resolve")) return new Response(JSON.stringify({ resolved: true, shape: "goalWalkState", body: shown }), { status: 200 });
  return new Response("{}", { status: 200 });
}) as typeof fetch;

const uiSrc = new URL("../ui/src/", import.meta.url).pathname;
const React = await import(Bun.resolveSync("react", uiSrc));
const { createRoot: rawCreateRoot } = await import(Bun.resolveSync("react-dom/client", uiSrc));
const createRoot = (...a: Parameters<typeof rawCreateRoot>) => trackRoot(rawCreateRoot(...a));
const { act } = React;
const { QueryClient, QueryClientProvider } = await import(Bun.resolveSync("@tanstack/react-query", uiSrc));
const { LiveControlsProvider } = await import("../ui/src/state/liveControls");
const { QuestionsProvider } = await import("../ui/src/state/questions");
const { RunView } = await import("../ui/src/components/RunView");
const { BoxTargetProvider, useBoxTarget } = await import("../ui/src/state/boxTarget");
/** What the run page hands the one box as the result a verdict judges. */
let judged: unknown = null;
function JudgedProbe(): null {
  judged = useBoxTarget()?.judged ?? null;
  return null;
}
const { fromAPerson, personDrivenStep } = await import("../ui/src/lib/provenance");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterAll(async () => {
  await teardownDom();
});

let shown: Record<string, unknown> = walk;

async function mount(w: Record<string, unknown> = walk): Promise<HTMLElement> {
  shown = w;
  const el = document.createElement("div");
  document.body.appendChild(el);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    createRoot(el).render(
      React.createElement(QueryClientProvider, { client: qc }, React.createElement(LiveControlsProvider, null, React.createElement(QuestionsProvider, null, React.createElement(BoxTargetProvider, null, React.createElement(RunView, { dispatchId }), React.createElement(JudgedProbe))))),
    );
  });
  for (let i = 0; i < 4; i++) await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
  return el;
}

const answered = { id: "solicitation-s", revision: 1, title: "q", body: "q", createdAt: 0, updatedAt: 0, responses: [], answered: true, declined: false, run: { dispatchId, solicitationId: "s", deadlineAt: null, linked: true } };

const USED = "[goal-host-vessel] /run-goal: human answered solicitation — retrying activity:rain_ranker with human_input context";

describe("person provenance", () => {
  test("a person's answer counts only when this surface holds it AND the walk used it", () => {
    expect(personDrivenStep(dispatchId, [USED], [answered as never])).toBe("activity:rain_ranker");
    expect(personDrivenStep(dispatchId, [USED], [])).toBeNull();
    expect(personDrivenStep(dispatchId, [], [answered as never])).toBeNull();
    expect(fromAPerson("template:rain_ranker", "activity:rain_ranker")).toBe(true);
    expect(fromAPerson("satisfier:human_input", "activity:rain_ranker")).toBe(false);
    expect(fromAPerson("satisfier:human_input", null)).toBe(false);
  });

  test("must-fail: a stand-in's output gets no person mark; its producer stays visible, and a grade carries what it judged", async () => {
    questions = [];
    const el = await mount();
    const answer = el.querySelector("[aria-label='Answer']");
    expect(answer).not.toBeNull();
    expect(el.querySelector(".sf-person-mark")).toBeNull();
    // Shown, not hidden.
    expect(answer?.textContent).toContain("raining");
    // A verdict is typed in the box (the grade form retired); the run page hands the box what it judges.
    const j = judged as { dispatchId: string; about: Record<string, unknown> } | null;
    expect(j?.dispatchId).toBe(dispatchId);
    expect(j?.about).toMatchObject({ shape: "human_input", produced_by: "satisfier:human_input" });
    expect(j?.about["provenance"]).toBeUndefined();
  });

  test("an output from the step a person's answer drove is marked as theirs", async () => {
    questions = [answered];
    const pool = walk["poolProvenance"] as Record<string, unknown>[];
    const ranked = { id: "r", shape: "rainRanking", producedBy: "template:rain_ranker", contentPreview: "Bergen 60.4N; Seattle 47.6N", chars: 27, consumedIds: [String(pool[0]?.["id"] ?? "g")] };
    const el = await mount({ ...walk, walkLog: [USED], completionShapes: ["rainRanking"], poolProvenance: [...pool, ranked] });
    expect(el.querySelector(".sf-person-mark")?.textContent).toBe("your answer");
  });
});
