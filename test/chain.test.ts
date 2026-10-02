/**
 * A run as a chain of impulses, built only from what goal-host serves since
 * slice V4 (pool ids, real producers, bound `consumedIds`). Fixture: the live
 * walk state of dispatch fb068805 (10-02), a news goal that searched, wrote a
 * report from the search, and also ran a detour through activity_template and
 * error into problem_detection.
 */
import { describe, expect, test } from "bun:test";
import type { GoalWalkState } from "../ui/src/api/types";
import { buildChains, inputsOf } from "../ui/src/lib/chain";
import fixture from "./fixtures/chain-fb068805.json";

function walk(over: Partial<GoalWalkState>): GoalWalkState {
  return {
    dispatchId: "d-chain",
    status: "failed",
    reached: false,
    goalReachReason: null,
    poolShapes: [],
    poolProvenance: [],
    pendingTargets: [],
    poolEvents: [],
    walkLog: [],
    currentStep: null,
    steps: [],
    executionPath: null,
    walkTier: null,
    attemptCount: null,
    grounded: null,
    learning: null,
    answerBody: null,
    operator: null,
    completionShapes: null,
    humanGraded: false,
    humanReachNotes: null,
    trigger: null,
    requeueOf: null,
    ...over,
  };
}

describe("buildChains on a live run", () => {
  const w = walk(fixture as unknown as Partial<GoalWalkState>);
  const chains = buildChains(w);

  test("the outputs are the terminal derivations, largest first", () => {
    expect(chains.outputs.map((n) => n.shape)).toEqual(["llm_completion", "problem_detection"]);
  });

  test("the report's inputs are the search and the fetched resource it was bound to", () => {
    const report = chains.outputs[0]!;
    expect(inputsOf(report, chains).inputs.map((n) => n.shape).sort()).toEqual(["web_resource", "web_search"]);
    expect(inputsOf(report, chains).missing).toEqual([]);
  });

  test("inputs consumed by an output are not also listed as unused; seeds never appear", () => {
    const unused = chains.unused.map((n) => n.shape);
    expect(unused).not.toContain("web_search");
    expect(unused).not.toContain("activity_template");
    expect(unused).not.toContain("goal");
    expect(unused).not.toContain("dispatch_id");
    expect(unused).toContain("llm_completion_result");
  });

  test("edges are recorded and the record is retained", () => {
    expect(chains.edgesRecorded).toBe(true);
    expect(chains.retained).toBe(true);
  });
});

describe("buildChains edge cases", () => {
  test("a blanked record is not retained", () => {
    expect(buildChains(walk({})).retained).toBe(false);
  });

  test("a record written before V4 has no edges: nothing leads and everything is listed as produced", () => {
    const c = buildChains(
      walk({
        poolProvenance: [
          { shape: "web_search", producedBy: "goal-host-walk", contentPreview: "x", chars: 1, truncated: false },
          { shape: "llm_completion", producedBy: "goal-host-walk", contentPreview: "y", chars: 1, truncated: false },
        ],
      }),
    );
    expect(c.edgesRecorded).toBe(false);
    expect(c.outputs).toEqual([]);
    expect(c.unused.map((n) => n.shape)).toEqual(["web_search", "llm_completion"]);
  });

  test("before V4, seeded shapes are recognised from the pool events and left out", () => {
    const c = buildChains(
      walk({
        poolEvents: [
          { shape: "goal", source: "investigate X", at: 1 },
          { shape: "dispatch_id", source: "seed var dispatch_id", at: 1 },
          { shape: "git_log", source: "vessel-resolve satisfier (git_log)", at: 2 },
        ],
        poolProvenance: [
          { shape: "goal", producedBy: "goal-host-walk", contentPreview: "investigate X", chars: 13, truncated: false },
          { shape: "dispatch_id", producedBy: "goal-host-walk", contentPreview: "d-1", chars: 3, truncated: false },
          { shape: "git_log", producedBy: "goal-host-walk", contentPreview: "abc fix", chars: 7, truncated: false },
        ],
      }),
    );
    expect(c.unused.map((n) => n.shape)).toEqual(["git_log"]);
  });

  test("an input the record no longer holds is reported missing, not invented", () => {
    const c = buildChains(
      walk({
        poolProvenance: [
          { id: "a", shape: "llm_completion", producedBy: "satisfier:llm_completion", consumedIds: ["gone"], contentPreview: "y", chars: 1, truncated: false },
        ],
      }),
    );
    expect(inputsOf(c.outputs[0]!, c)).toEqual({ inputs: [], missing: ["gone"] });
  });

  test("an intermediate output (consumed and consuming) appears under its consumer, not at the top", () => {
    const c = buildChains(
      walk({
        poolProvenance: [
          { id: "s", shape: "web_search", producedBy: "satisfier:web_search", consumedIds: [], contentPreview: "s", chars: 1, truncated: false },
          { id: "m", shape: "summary", producedBy: "satisfier:llm_completion", consumedIds: ["s"], contentPreview: "m", chars: 5, truncated: false },
          { id: "r", shape: "report", producedBy: "satisfier:llm_completion", consumedIds: ["m"], contentPreview: "r", chars: 2, truncated: false },
        ],
      }),
    );
    expect(c.outputs.map((n) => n.id)).toEqual(["r"]);
    expect(inputsOf(c.outputs[0]!, c).inputs.map((n) => n.id)).toEqual(["m"]);
  });
});
