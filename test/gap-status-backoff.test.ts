/**
 * The questions read refreshes the status of the gaps its questions escalated, in the background.
 * When no vessel answers a gap's status (no gap store serving), the rest of that read is not sent
 * and the next waits longer each time, so a shape no one serves is not asked for on every poll.
 *
 * Shape: node1 11-15, with no producer of substrateGap, ~122 "no producer" forwards a minute in
 * bursts of 4 (research, from discovery's log): every questions read re-sent up to 60 ids.
 */
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { restoreNativeGlobals } from "./setup.ts";
import { gapStatusWaitMs, knownGapStatus, refreshGapStatuses, resetGapStatusesForTest } from "../src/routes/proxy.ts";
import { DISCOVERY_ENDPOINT } from "../src/config.ts";

await restoreNativeGlobals();
const realFetch = globalThis.fetch;
let serving = false;
let asked = 0;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  if (String(input).startsWith(DISCOVERY_ENDPOINT.replace(/\/+$/, ""))) {
    asked++;
    if (!serving) return Response.json({ error: "no producer" }, { status: 404 });
    const id = (JSON.parse(String(init?.body)).pointer ?? JSON.parse(String(init?.body)))["id"];
    return Response.json({ resolved: true, shape: "substrateGap", body: { gaps: [{ id, status: "closed" }] } });
  }
  return Response.json({});
}) as typeof fetch;
afterAll(() => {
  globalThis.fetch = realFetch;
});
beforeEach(() => {
  resetGapStatusesForTest();
  serving = false;
  asked = 0;
});

const IDS = Array.from({ length: 20 }, (_, i) => `agf_test-${i}`);

describe("gap status with no one serving it", () => {
  test("must-fail: one unanswered status stops the rest of that read", async () => {
    await refreshGapStatuses(IDS);
    // The workers each send at most one before they see no answer.
    expect(asked).toBeGreaterThan(0);
    expect(asked).toBeLessThan(IDS.length);
  });

  test("must-fail: the next read waits, and sends nothing until the wait has passed", async () => {
    await refreshGapStatuses(IDS);
    const first = asked;
    await refreshGapStatuses(IDS);
    await refreshGapStatuses(IDS);
    expect(asked).toBe(first);
    expect(knownGapStatus(IDS[0]!)).toBeNull();
  });

  test("the wait doubles from the floor and stops at the cap; none before the first miss", () => {
    expect(gapStatusWaitMs(0, 5_000, 600_000)).toBe(0);
    expect(gapStatusWaitMs(1, 5_000, 600_000)).toBe(5_000);
    expect(gapStatusWaitMs(2, 5_000, 600_000)).toBe(10_000);
    expect(gapStatusWaitMs(4, 5_000, 600_000)).toBe(40_000);
    expect(gapStatusWaitMs(99, 5_000, 600_000)).toBe(600_000);
  });

  test("control: a store that answers is read for every id, and its statuses are kept", async () => {
    serving = true;
    await refreshGapStatuses(IDS);
    expect(asked).toBe(IDS.length);
    expect(knownGapStatus(IDS[3]!)).toBe("closed");
  });
});
