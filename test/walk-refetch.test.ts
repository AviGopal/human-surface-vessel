/**
 * A finished run is re-read slowly, a running one live. On 10-14 one tab polled
 * a completed run every ~2 s for hours, and each poll made goal-host re-read
 * that run's labels (~28 sorted DB reads a minute on a saturated host).
 */
import { describe, expect, test } from "bun:test";
import { FINISHED_WALK_REFETCH_MS, walkRefetchMs } from "../ui/src/api/queries";

describe("walk polling", () => {
  test("a running walk keeps the live cadence", () => {
    expect(walkRefetchMs({ status: "running" }, true, 2000)).toBe(2000);
    expect(walkRefetchMs(undefined, true, 2000)).toBe(2000);
  });

  test("must-fail: a finished walk is re-read once a minute, not every 2 s", () => {
    expect(walkRefetchMs({ status: "completed" }, true, 2000)).toBe(FINISHED_WALK_REFETCH_MS);
    expect(walkRefetchMs({ status: "failed" }, true, 2000)).toBe(FINISHED_WALK_REFETCH_MS);
    expect(FINISHED_WALK_REFETCH_MS).toBeGreaterThanOrEqual(60_000);
  });

  test("paused stays paused; a slower live cadence is never sped up", () => {
    expect(walkRefetchMs({ status: "completed" }, false, 2000)).toBe(false);
    expect(walkRefetchMs({ status: "completed" }, true, 120_000)).toBe(120_000);
  });
});
