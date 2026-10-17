/**
 * Three run pages from 10-13, made legible:
 *  0a53b2f5 — every output a reference: no "Produced" fold that opens onto nothing.
 *  09757917 — still running: a 130 KB record stays one line; "Missing" offers
 *             Provide only for what a person can provide, never execution_trace.
 *  879e672e — "deterministic:hollow_walklog_capped — …": the code is a tag.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://surface.test/" });

import { afterAll, describe, expect, test } from "bun:test";
import type { GoalWalkState } from "../ui/src/api/types";
import { splitVerdict } from "../ui/src/lib/verdict";

let walk: Record<string, unknown> = {};
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = String(input);
  if (url.includes("/api/person-shapes")) return new Response(JSON.stringify({ resolved: true, body: { shapes: ["human_input"] } }), { status: 200 });
  if (url.includes("/api/questions")) return new Response(JSON.stringify({ resolved: true, success: true, body: { questions: [] } }), { status: 200 });
  if (url.includes("/api/resolve")) return new Response(JSON.stringify({ resolved: true, shape: "goalWalkState", body: walk }), { status: 200 });
  return new Response("{}", { status: 200 });
}) as typeof fetch;

const uiSrc = new URL("../ui/src/", import.meta.url).pathname;
const from = (spec: string): string => Bun.resolveSync(spec, uiSrc);
const React = await import(from("react"));
const { createRoot } = await import(from("react-dom/client"));
const { act } = React;
const { QueryClient, QueryClientProvider } = await import(from("@tanstack/react-query"));
const { LiveControlsProvider } = await import("../ui/src/state/liveControls");
const { QuestionsProvider } = await import("../ui/src/state/questions");
const { RunView } = await import("../ui/src/components/RunView");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function base(over: Record<string, unknown>): Record<string, unknown> {
  return {
    dispatchId: "d-tidy", goal: "g", status: "failed", reached: false, goalReachReason: null, poolShapes: [], poolProvenance: [],
    pendingTargets: [], poolEvents: [], walkLog: [], currentStep: null, steps: [], executionPath: null, walkTier: null,
    attemptCount: null, grounded: null, learning: null, answerBody: null, operator: "human-surface", completionShapes: null,
    humanGraded: false, humanReachNotes: null, trigger: null, requeueOf: null, ...over,
  } as unknown as GoalWalkState as unknown as Record<string, unknown>;
}

async function mount(w: Record<string, unknown>): Promise<HTMLElement> {
  walk = w;
  const el = document.createElement("div");
  document.body.appendChild(el);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    createRoot(el).render(
      React.createElement(QueryClientProvider, { client: qc },
        React.createElement(LiveControlsProvider, null, React.createElement(QuestionsProvider, null, React.createElement(RunView, { dispatchId: "d-tidy" })))),
    );
  });
  for (let i = 0; i < 3; i++) await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
  return el;
}

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

const stub = (by: string, e: string): string => JSON.stringify({ producedBy: by, executionId: e });
const seed = { id: "g", shape: "goal", producedBy: "seed", contentPreview: "q", chars: 1, consumedIds: [] };

describe("verdict codes", () => {
  test("the system's code is split from the text", () => {
    expect(splitVerdict("deterministic:hollow_walklog_capped — all 1 logged walk step(s) produced 0 new shapes")).toEqual({
      code: "hollow_walklog_capped",
      text: "all 1 logged walk step(s) produced 0 new shapes",
    });
    expect(splitVerdict("partial-coverage — reached on a STRICT SUBSET").code).toBe("partial-coverage");
    expect(splitVerdict("The shellResult only shows a directory listing").code).toBeNull();
  });

  test("must-fail: the run header draws the code as a tag, not as the reason's first words (879e672e)", async () => {
    const el = await mount(base({ goalReachReason: "deterministic:hollow_walklog_capped — all 1 logged walk step(s) produced 0 new shapes" }));
    const head = el.querySelector(".sf-run-reason-full");
    expect(head?.querySelector(".sf-verdict-code")?.textContent).toBe("hollow_walklog_capped");
    expect(head?.textContent).not.toContain("deterministic:");
  });
});

describe("Missing", () => {
  test("must-fail: Provide is offered only for what this surface answers by asking a person (09757917)", async () => {
    // The surface's own declaration, not a name pattern: human_context matches "human_" but no
    // person is ever asked for it, so it is not offered.
    const el = await mount(base({ status: "running", reached: null, pendingTargets: ["execution_trace", "human_context", "human_input"] }));
    const rows = [...el.querySelectorAll(".sf-needs-list li")].map((li) => [li.querySelector(".sf-shape-badge")?.textContent, li.querySelector("button")?.textContent ?? null]);
    expect(rows).toEqual([["execution_trace", null], ["human_context", null], ["human_input", "Provide"]]);
  });
});

describe("Outputs", () => {
  test("must-fail: a running run's big record stays one line (09757917)", async () => {
    const big = JSON.stringify({ gaps: Array.from({ length: 40 }, (_, i) => ({ id: `runtime-drift-${i}`, summary: "x".repeat(60) })) });
    const el = await mount(base({ status: "running", reached: null, poolProvenance: [seed, { id: "s", shape: "substrateGap", producedBy: "activity:t", contentPreview: big.slice(0, 2000), chars: 130544, truncated: true, consumedIds: ["g"] }] }));
    expect(el.querySelector(".sf-chain-output")).toBeNull();
    expect(el.querySelector(".sf-chain-collapsed summary")?.textContent).toContain("substrateGap");
  });

  test("must-fail: when every output is a reference, there is no empty Produced fold (0a53b2f5)", async () => {
    const el = await mount(base({ poolProvenance: [seed, ...["shellResult", "llm_completion", "memoryNote_write", "fileContent"].map((sh, i) => ({ id: `r${i}`, shape: sh, producedBy: "activity:x", contentPreview: stub("activity:x", `e${i}`), chars: 120, consumedIds: [] }))] }));
    const summaries = [...el.querySelectorAll("[aria-label='Outputs'] summary")].map((s) => s.textContent);
    expect(summaries).toContain("No content · 4");
    expect(summaries.some((s) => s?.startsWith("Produced"))).toBe(false);
  });
});

describe("the attempts strip (958e0dcd, 10-13)", () => {
  const B = "deterministic:hollow_walklog_capped — all 1 logged walk step(s) produced 0 new shapes; LLM judge SKIPPED (it cannot out-testify the walk's own log)";
  const events = (t: number) => [
    { shape: "goal", source: "goal", at: t },
    { shape: "dispatch_id", source: "seed var dispatch_id", at: t + 1 },
  ];
  test("must-fail: the reported attempt is marked and repeated verdicts are not printed again", async () => {
    const el = await mount(
      base({
        goalReachReason: B,
        poolEvents: [...events(1000), ...events(22000), ...events(106000)],
        walkLog: [
          "walk: HOLLOW — deterministic:unsourced-current-information — the goal asks for current information and the chain consulted no source; β WITHHELD",
          "/run-goal: walk: FEEDBACK-RETRY — re-running",
          `walk: HOLLOW — ${B}; β WITHHELD`,
          "/run-goal: walk: hollow satisfier verdict — re-running with suppressSatisfierShapes",
          `walk: HOLLOW — ${B}; β WITHHELD`,
        ],
      }),
    );
    const rows = [...el.querySelectorAll("[aria-label='Attempts'] li")];
    expect(rows.length).toBe(3);
    expect(rows[0]?.textContent).toContain("the goal asks for current information");
    expect(rows[1]?.textContent).toContain("all 1 logged walk step(s)");
    expect(rows[2]?.querySelector(".sf-attempt-reported")?.textContent).toBe("reported");
    expect(rows[2]?.textContent).not.toContain("all 1 logged walk step(s)");
    expect(rows[2]?.textContent).toContain("the verdict above");
    const sentence = (el.querySelector("[aria-label='Attempts']")?.textContent ?? "").split("all 1 logged walk step(s)").length - 1;
    expect(sentence).toBe(1);
  });
});

describe("a run the judge did not grade (80a57177, cc920124)", () => {
  const ABSTAIN = "abstain:cut-view — the deliverable did not fit the judge's view (executionTraceList 24000/27665 chars); not graded";
  test("must-fail: it reads as not graded, not as not reached, and the grade box asks for a verdict", async () => {
    const el = await mount(base({ status: "failed", reached: null, goalReachReason: ABSTAIN, executionId: "exec_abstain" }));
    const badge = el.querySelector(".sf-view-head .sf-verdict");
    expect(badge?.getAttribute("data-state")).toBe("ungraded");
    expect(badge?.textContent).toContain("not graded");
    const grade = el.querySelector("[aria-label='Grade']")?.textContent ?? "";
    expect(grade).toContain("Your verdict");
    expect(grade).toContain("Reached");
    expect(grade).not.toContain("Disagree with the verdict?");
  });
});
