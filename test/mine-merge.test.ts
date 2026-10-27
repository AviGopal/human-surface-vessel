/**
 * Who asked a run comes from the surface's own record, never from goal-host's operator
 * label. goal-host lists a run the page asked under the surface's key, operator null and
 * operator_label "human-surface"; its row is the fresher on state, so it wins the merge,
 * and before this the run fell out of "Mine" while goal-host still listed it.
 *
 * Shape: one node 10-27, the landing's teaching ask 67f6fd19: in the own record, absent
 * from Mine, listed by goal-host with operator null.
 */
import { describe, expect, test } from "bun:test";
import { mergeOwnDispatches } from "../ui/src/api/client";
import { isMine } from "../ui/src/components/RunsList";
import type { ActiveDispatch } from "../ui/src/api/types";

const board = [
  { dispatchId: "67f6fd19", goal: "What time is it in Lisbon?", operator: null, operator_label: "human-surface", trigger: "run-goal", status: "completed", reached: true, startedAt: 1793062633647 },
  { dispatchId: "sys-1", goal: "reconcile the trace store", operator: null, trigger: "run-goal", status: "failed", reached: false, startedAt: 1793062600000 },
] as unknown as ActiveDispatch[];
const mine = [
  { dispatchId: "67f6fd19", goal: "What time is it in Lisbon?", operator: "human-surface", status: "running", reached: null, startedAt: 1793062633724, own: true, person: { userId: "user:person-a", name: "Person A" } },
  { dispatchId: "old-1", goal: "Who am I?", operator: "human-surface", status: "failed", reached: false, startedAt: 1793000000000, own: true, person: null },
] as unknown as ActiveDispatch[];

describe("the merge keeps who asked", () => {
  test("must-fail: a run goal-host lists with operator null is the person's when the own record has it", () => {
    const merged = mergeOwnDispatches(board, mine);
    const t = merged.find((d) => d.dispatchId === "67f6fd19")!;
    expect(isMine(t)).toBe(true);
    expect(t.person).toEqual({ userId: "user:person-a", name: "Person A" });
    // goal-host's copy is still the fresher on state
    expect(t.status).toBe("completed");
    expect(t.reached).toBe(true);
  });

  test("a system run is not the person's, and an own run goal-host no longer lists still is", () => {
    const merged = mergeOwnDispatches(board, mine);
    expect(isMine(merged.find((d) => d.dispatchId === "sys-1")!)).toBe(false);
    expect(isMine(merged.find((d) => d.dispatchId === "old-1")!)).toBe(true);
  });

  test("must-fail: an operator label alone makes no run the person's", () => {
    const labelled = { dispatchId: "x", goal: "g", operator: "human-surface", trigger: null, status: "completed", reached: true, startedAt: 0 } as unknown as ActiveDispatch;
    expect(isMine(labelled)).toBe(false);
  });
});
