/**
 * Attempt segmentation over a walk state whose `poolEvents` span several walks
 * while `steps` / `poolProvenance` carry only the latest one — the shape of a
 * live retry/re-frame dispatch (three seed bursts at 0s, 152s, 446s).
 */
import { describe, expect, test } from "bun:test";
import type { GoalWalkState, PoolEvent } from "../ui/src/api/types";
import { segmentAttempts } from "../ui/src/lib/attempts";

const GOAL = "learning-loop-selftest: exercise the chain";

function burst(at: number): PoolEvent[] {
  return [
    { shape: "goal", source: GOAL, at },
    { shape: "probe_tag", source: "seed var probe_tag", at },
    { shape: "goal", source: "seed var goal", at },
    { shape: "dispatch_id", source: "seed var dispatch_id", at },
  ];
}

function walk(over: Partial<GoalWalkState>): GoalWalkState {
  return {
    dispatchId: "d-attempts",
    status: "running",
    reached: null,
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

const T = 1_790_768_069_858;
const events: PoolEvent[] = [
  ...burst(T),
  { shape: "problem_detection", source: "produced by activity:⟨a⟩", at: T + 43_000 },
  ...burst(T + 152_000),
  { shape: "problem_detection", source: "produced by activity:⟨b⟩", at: T + 194_000 },
  ...burst(T + 446_000),
  { shape: "test_suite", source: "vessel-resolve satisfier (test_suite)", at: T + 581_000 },
];
const log = [
  "[goal-host-vessel] /run-goal: walk: FEEDBACK-RETRY — re-running the same chain",
  "[goal-host-vessel] /run-goal: walk: re-framing to alternative target shapes [\"gate_self_probe\"] after no-pick",
];

describe("segmentAttempts", () => {
  test("splits at each seed burst and aligns restart reasons to the later attempts", () => {
    const segs = segmentAttempts(
      walk({
        dispatchId: "d-split",
        poolEvents: events,
        walkLog: log,
        steps: [{ index: 0, at: T + 581_000, selected: { templateId: "satisfier:test_suite" } }],
        poolProvenance: [{ shape: "test_suite", contentPreview: "ok", chars: 2, truncated: false }],
      }),
    );
    expect(segs.map((s) => s.number)).toEqual([1, 2, 3]);
    expect(segs.map((s) => s.startAt)).toEqual([T, T + 152_000, T + 446_000]);
    expect(segs.map((s) => s.events.length)).toEqual([5, 5, 5]);
    expect(segs[0]?.reason).toBeNull();
    expect(segs[1]?.reason).toBe("retried with the prior verdict");
    expect(segs[2]?.reason).toContain("re-framed to alternative targets");
    // Only the latest attempt carries the server's content; earlier ones were never seen here.
    expect(segs[2]?.current).toBe(true);
    expect(segs[2]?.steps.length).toBe(1);
    expect(segs[0]?.provenance).toBeNull();
  });

  test("an attempt this page watched keeps its content after the next one starts", () => {
    const id = "d-watched";
    const first = [{ shape: "problem_detection", contentPreview: "first", chars: 5, truncated: false }];
    segmentAttempts(walk({ dispatchId: id, poolEvents: events.slice(0, 5), poolProvenance: first }));
    const segs = segmentAttempts(
      walk({
        dispatchId: id,
        poolEvents: events.slice(0, 10),
        poolProvenance: [{ shape: "problem_detection", contentPreview: "second", chars: 6, truncated: false }],
      }),
    );
    expect(segs.length).toBe(2);
    expect(segs[0]?.provenance).toEqual(first);
    expect(segs[1]?.provenance?.[0]?.contentPreview).toBe("second");
  });

  test("the previous walk's content is not shown under a new attempt that has not mirrored yet", () => {
    const id = "d-stale";
    const first = [{ shape: "problem_detection", contentPreview: "first", chars: 5, truncated: false }];
    segmentAttempts(walk({ dispatchId: id, poolEvents: events.slice(0, 5), poolProvenance: first }));
    // New seed burst has arrived, provenance on the record is still the old walk's.
    const segs = segmentAttempts(walk({ dispatchId: id, poolEvents: events.slice(0, 9), poolProvenance: first }));
    expect(segs.length).toBe(2);
    expect(segs[0]?.provenance).toEqual(first);
    expect(segs[1]?.provenance).toEqual([]);
  });

  test("a single walk is one attempt", () => {
    const segs = segmentAttempts(walk({ dispatchId: "d-one", poolEvents: events.slice(0, 5) }));
    expect(segs.length).toBe(1);
    expect(segs[0]?.current).toBe(true);
  });

  test("each attempt carries its own rejection, and the reported attempt can be a middle one", () => {
    const hollow = (r: string, tail = "; β WITHHELD (α was structurally unreachable") => `[goal-host-vessel] walk(/run-goal): HOLLOW — ${r}${tail}`;
    const segs = segmentAttempts(
      walk({
        dispatchId: "d-reported",
        status: "failed",
        reached: false,
        // A retry replaces the reported walk; a re-frame that does not reach does not —
        // so attempt 2 is the one the dispatch reports (the 523e099d pattern).
        goalReachReason: "The output contains an error and does not fulfill the goal.",
        poolEvents: events,
        walkLog: [
          hollow("It failed to generate meaningful content."),
          "[goal-host-vessel] /run-goal: walk: FEEDBACK-RETRY — re-running the same chain",
          hollow("The output contains an error and does not fulfill the goal.", "; β-penalised last pick activity:x"),
          "[goal-host-vessel] /run-goal: walk: re-framing to alternative target shapes [\"a\"] after no-pick",
          hollow("It only includes headlines."),
        ],
      }),
    );
    expect(segs.map((s) => s.verdict)).toEqual([
      "It failed to generate meaningful content.",
      "The output contains an error and does not fulfill the goal.",
      "It only includes headlines.",
    ]);
    expect(segs.map((s) => s.reported)).toEqual([false, true, false]);
  });

  test("a reached run reports its last attempt; an unmatched reason reports none", () => {
    const reached = segmentAttempts(walk({ dispatchId: "d-reached", status: "completed", reached: true, poolEvents: events }));
    expect(reached.map((s) => s.reported)).toEqual([false, false, true]);
    const unknown = segmentAttempts(walk({ dispatchId: "d-unknown", reached: false, goalReachReason: "something else", poolEvents: events }));
    expect(unknown.some((s) => s.reported)).toBe(false);
  });
});
