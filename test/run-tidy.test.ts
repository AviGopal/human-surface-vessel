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
import { teardownDom, trackRoot } from "./setup.ts";
import type { GoalWalkState } from "../ui/src/api/types";
import { splitVerdict } from "../ui/src/lib/verdict";

let walk: Record<string, unknown> = {};
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = String(input);
  if (url.includes("/api/questions")) return new Response(JSON.stringify({ resolved: true, success: true, body: { questions: [] } }), { status: 200 });
  if (url.includes("/api/resolve")) return new Response(JSON.stringify({ resolved: true, shape: "goalWalkState", body: walk }), { status: 200 });
  return new Response("{}", { status: 200 });
}) as typeof fetch;

const uiSrc = new URL("../ui/src/", import.meta.url).pathname;
const from = (spec: string): string => Bun.resolveSync(spec, uiSrc);
const React = await import(from("react"));
const { createRoot: rawCreateRoot } = await import(from("react-dom/client"));
const createRoot = (...a: Parameters<typeof rawCreateRoot>) => trackRoot(rawCreateRoot(...a));
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
  const root = createRoot(el);
  roots.push(root);
  await act(async () => {
    root.render(
      React.createElement(QueryClientProvider, { client: qc },
        React.createElement(LiveControlsProvider, null, React.createElement(QuestionsProvider, null, React.createElement(RunView, { dispatchId: "d-tidy" })))),
    );
  });
  for (let i = 0; i < 3; i++) await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
  return el;
}

const roots: { unmount: () => void }[] = [];
afterAll(async () => {
  await teardownDom();
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

  test("must-fail: a nested floor prefix is split to its findings, not left in the prose (one node, 10-18)", () => {
    const v = splitVerdict("floor floor:upstream-not-reached: deterministic:unsourced-current-information — the goal asks for current information and the chain consulted no source in-run");
    expect(v.code).toBe("upstream-not-reached · unsourced-current-information");
    expect(v.text).toBe("the goal asks for current information and the chain consulted no source in-run");
    // The same prefix ending in a colon, with no dash.
    const c = splitVerdict("floor floor:upstream-not-reached: The output did not process any actual web search results.");
    expect(c).toEqual({ code: "upstream-not-reached", text: "The output did not process any actual web search results." });
    // Prose that happens to contain a dash is left alone, and so is prose that opens with a colon phrase.
    expect(splitVerdict("Note: the run stopped early").code).toBeNull();
    expect(splitVerdict("note: The run stopped early").code).toBeNull();
    expect(splitVerdict("The output was partial — it listed only two sources").code).toBeNull();
  });

  test("must-fail: the run header reads the reason, not the system's code for it (879e672e, 16g)", async () => {
    // The code is the system's label, not words for a person: it leaves the lead and stays on hover;
    // the fold ("How it went") still draws it beside each attempt's verdict.
    const el = await mount(base({ goalReachReason: "deterministic:hollow_walklog_capped — all 1 logged walk step(s) produced 0 new shapes" }));
    const head = el.querySelector(".sf-run-reason-full");
    expect(head?.querySelector(".sf-verdict-code")).toBeNull();
    expect(head?.textContent).not.toContain("hollow_walklog_capped");
    expect(head?.textContent).not.toContain("deterministic:");
    expect(head?.textContent).toContain("all 1 logged walk step(s) produced 0 new shapes");
    expect(head?.getAttribute("title")).toBe("hollow_walklog_capped");
  });
});

describe("Missing", () => {
  test("Provide is offered for anything the walk still needs, folded until opened (09757917, user rulings 10-17)", async () => {
    // What a person writes here is a person's input by provenance, whatever its shape, so no shape is
    // excluded by name. The list stays folded, so a walk's machine vocabulary is not put in front of
    // the person unless they open it.
    const el = await mount(base({ status: "running", reached: null, pendingTargets: ["execution_trace", "human_context", "human_input"] }));
    expect(el.querySelector(".sf-walk-needs")?.hasAttribute("open")).toBe(false);
    // What the walk still needs, not a defect: "Needed", not "Missing" (16g).
    expect(el.querySelector(".sf-walk-needs summary")?.textContent).toBe("Needed · 3");
    const rows = [...el.querySelectorAll(".sf-needs-list li")].map((li) => [li.querySelector(".sf-shape-badge")?.textContent, li.querySelector("button")?.textContent ?? null]);
    expect(rows).toEqual([["execution_trace", "Provide"], ["human_context", "Provide"], ["human_input", "Provide"]]);
    // One place to type: no second free-text control for the same run (16b).
    expect([...el.querySelectorAll("summary")].map((x) => x.textContent)).not.toContain("Add other context");
    expect(el.querySelector(".sf-walk-needs input, .sf-walk-needs textarea")).toBeNull();
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
