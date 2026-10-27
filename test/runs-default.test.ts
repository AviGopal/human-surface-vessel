/**
 * The first screen shows the reader's own runs, and the newest of them in the
 * main pane, not an empty "select something" pane over everyone's runs.
 */
import { describe, expect, test } from "bun:test";
import type { ActiveDispatch } from "../ui/src/api/types";
import { initialFilter, latestMine } from "../ui/src/components/RunsList";

// A row is the person's when the surface's own record has it (`own`), as the merge marks it; the operator label decides nothing.
const row = (dispatchId: string, operator: string, startedAt: string): ActiveDispatch =>
  ({ dispatchId, operator, startedAt, status: "completed", reached: false, ...(operator === "human-surface" ? { own: true } : {}) }) as unknown as ActiveDispatch;

describe("latestMine", () => {
  test("the newest run asked from this surface", () => {
    expect(
      latestMine([
        row("sys", "rhythm-conductor-drain", "2026-10-12T19:59:00Z"),
        row("old", "human-surface", "2026-10-12T19:40:00Z"),
        row("new", "human-surface", "2026-10-12T19:56:00Z"),
      ]),
    ).toBe("new");
  });

  test("must-fail: a run whose record is gone never opens the first screen", () => {
    const gone = { ...row("newest", "human-surface", "2026-10-12T19:58:00Z"), status: "gone" } as unknown as ActiveDispatch;
    expect(latestMine([gone, row("kept", "human-surface", "2026-10-12T19:40:00Z")])).toBe("kept");
    expect(latestMine([gone])).toBeNull();
  });

  test("must-fail: system runs never stand in for the reader's", () => {
    expect(latestMine([row("sys", "gap-decompose", "2026-10-12T19:59:00Z")])).toBeNull();
    expect(latestMine(undefined)).toBeNull();
  });
});

describe("initialFilter", () => {
  test("defaults to the reader's own runs when nothing is remembered", () => {
    expect(initialFilter()).toBe("mine");
  });
});
