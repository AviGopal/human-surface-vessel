/**
 * A run's state comes from fields the surface read, never from its own reading
 * of log text: `waiting` only from an open question linked to the run,
 * `stalled` with the silence that made it so, row hover text only as written.
 * Pure: no DOM, nothing resolved from ui/node_modules.
 */
import { describe, expect, test } from "bun:test";
import type { Question } from "../ui/src/api/participation";
import { deriveRunState, rowReason, stalledForMs, STALL_AFTER_MS, type RunFacts } from "../ui/src/lib/runState";
import { openRunQuestion } from "../ui/src/lib/walk";

const NOW = 1_000_000;

function question(run: Partial<NonNullable<Question["run"]>> | undefined, extra: Partial<Question> = {}): Question {
  return {
    id: "q1",
    revision: 1,
    title: "t",
    body: "b",
    createdAt: 0,
    updatedAt: 0,
    responses: [],
    answered: false,
    declined: false,
    ...(run ? { run: { dispatchId: "d1", solicitationId: "s1", deadlineAt: NOW + 60_000, linked: true, ...run } } : {}),
    ...extra,
  };
}

describe("openRunQuestion", () => {
  test("an open question linked to the run is found", () => {
    expect(openRunQuestion([question({})], "d1", NOW)?.id).toBe("q1");
  });

  test("must-fail: no question, unlinked, another run, answered, declined or past deadline is not open", () => {
    expect(openRunQuestion(undefined, "d1", NOW)).toBeNull();
    expect(openRunQuestion([question(undefined)], "d1", NOW)).toBeNull();
    expect(openRunQuestion([question({ linked: false })], "d1", NOW)).toBeNull();
    expect(openRunQuestion([question({ dispatchId: "d2" })], "d1", NOW)).toBeNull();
    expect(openRunQuestion([question({}, { answered: true })], "d1", NOW)).toBeNull();
    expect(openRunQuestion([question({}, { declined: true })], "d1", NOW)).toBeNull();
    expect(openRunQuestion([question({ deadlineAt: NOW - 1 })], "d1", NOW)).toBeNull();
  });

  test("a null clock skips the stored deadline (an open run view heartbeats it)", () => {
    expect(openRunQuestion([question({ deadlineAt: NOW - 1 })], "d1", null)?.id).toBe("q1");
  });
});

const running: RunFacts = { status: "running", reached: null, awaitingAnswer: false, hasProgress: true, quietForMs: 0, acceptedForMs: 0 };

describe("stalledForMs", () => {
  test("a quiet run carries its silence; a silent accept carries its age", () => {
    expect(stalledForMs({ ...running, quietForMs: STALL_AFTER_MS + 5_000 })).toBe(STALL_AFTER_MS + 5_000);
    expect(stalledForMs({ ...running, hasProgress: false, quietForMs: 0, acceptedForMs: 400_000 })).toBe(400_000);
  });

  test("must-fail: any other state carries nothing", () => {
    expect(stalledForMs(running)).toBeNull();
    expect(stalledForMs({ ...running, awaitingAnswer: true, quietForMs: STALL_AFTER_MS * 10 })).toBeNull();
    expect(deriveRunState({ ...running, awaitingAnswer: true, quietForMs: STALL_AFTER_MS * 10 })).toBe("waiting");
  });
});

describe("rowReason", () => {
  test("the judge's reason or the error, as written; nothing of the surface's own", () => {
    expect(rowReason({ goalReachReason: " no chart " })).toBe("no chart");
    expect(rowReason({ goalReachReason: null, error: "timeout" })).toBe("timeout");
    expect(rowReason({ goalReachReason: "  " })).toBeNull();
  });
});
