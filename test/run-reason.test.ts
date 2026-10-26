/**
 * A run's reason under a person's override: goal-host writes
 * `[human override: <the person's words>] <the judge's reason>`. The person's
 * words are their own line; the judge's reason is drawn as a sentence. Together,
 * the leading bracket made the planner read the whole reason as structured data
 * and draw it as code.
 *
 * Shape: one node 10-26, a gap-closing edit run graded "Failed for a different reason".
 */
import { describe, expect, test } from "bun:test";
import { splitOverride } from "../ui/src/lib/verdict";
import { planContent } from "../ui/src/lib/ledger";

const JUDGE = "early edit-intent routed to feature_compose; refused at admission (stage=ineligible): the gap is not compose work, so it is neither walked nor escalated";
const REASON = `[human override: Failed for a different reason — Shouldn't use feature_compose] ${JUDGE}`;

describe("a reason under a person's override", () => {
  test("must-fail: the person's words and the judge's reason come apart", () => {
    expect(splitOverride(REASON)).toEqual({ person: "Failed for a different reason — Shouldn't use feature_compose", judge: JUDGE });
  });

  test("must-fail: the judge's part is drawn as prose, not code", () => {
    expect(planContent("goal_reach_reason", REASON, false).form).not.toBe("prose");
    expect(planContent("goal_reach_reason", splitOverride(REASON).judge, false).form).toBe("prose");
  });

  test("a reason with no override is left whole", () => {
    expect(splitOverride(` ${JUDGE} `)).toEqual({ person: null, judge: JUDGE });
    expect(splitOverride("[1, 2] not an override")).toEqual({ person: null, judge: "[1, 2] not an override" });
  });

  test("an override with nothing after it leaves no judge text", () => {
    expect(splitOverride("[human override: Worked]")).toEqual({ person: "Worked", judge: "" });
  });
});
