/**
 * The exposure record's rules, tested where they are pure.
 *
 * The real-Chromium half of the falsifier lives in `test/exposure-probe.ts`
 * (not a `.test.ts` file, following browser-participation.ts and
 * one-page-probe.ts): the suite must stay runnable with no browser present.
 * What is pinned HERE is everything a browser cannot make more true — the
 * geometry, the four distinct outcomes, and the honesty of the record's field
 * names and denominators.
 */
import { describe, expect, test } from "bun:test";
import {
  ExposureLedger,
  MACHINE_ORIGIN,
  buildExposureRecord,
  buildOutcomeRecord,
  visibleFraction,
  visibleSlice,
  type Candidate,
  type PresentationConditions,
  type Rect,
} from "../ui/src/lib/exposure";

const VIEWPORT: Rect = { x: 0, y: 0, width: 1440, height: 900 };

function candidate(id: string, rect: Rect, clips: readonly Rect[] = [VIEWPORT], rank = 1): Candidate {
  return {
    solicitationId: id,
    rank,
    rankSource: "dom_order",
    rankingExplanation: null,
    elementRole: "list_row",
    domPosition: rank,
    rect,
    clips,
  };
}

const CONDITIONS: PresentationConditions = {
  rendererBundle: "index-Dp37Wg-Y.js",
  viewport: { width: 1440, height: 900 },
  presentationVariant: "onepage",
};

describe("visibleFraction", () => {
  test("a box inside the viewport is fully visible", () => {
    expect(visibleFraction({ x: 10, y: 10, width: 300, height: 60 }, [VIEWPORT])).toBe(1);
  });

  test("a box entirely below the fold is not visible at all", () => {
    expect(visibleFraction({ x: 10, y: 1200, width: 300, height: 60 }, [VIEWPORT])).toBe(0);
  });

  test("a box straddling the fold reports the fraction, not a boolean", () => {
    expect(visibleFraction({ x: 0, y: 870, width: 100, height: 60 }, [VIEWPORT])).toBeCloseTo(0.5, 5);
  });

  test("a zero-area element (a hidden detail pane) is never visible", () => {
    // `hidden` panes are in the DOM with a 0x0 rect. Reporting DOM presence as
    // exposure is the specific mistake this measurement exists to avoid.
    expect(visibleFraction({ x: 0, y: 0, width: 0, height: 0 }, [VIEWPORT])).toBe(0);
  });

  test("a row scrolled out of an on-screen scroll container is cropped to nothing", () => {
    const list: Rect = { x: 0, y: 100, width: 400, height: 400 }; // the container, on screen
    const row: Rect = { x: 0, y: 620, width: 400, height: 60 }; // scrolled past its bottom
    expect(visibleFraction(row, [list, VIEWPORT])).toBe(0);
    // ... and the same row inside the container is fully visible.
    expect(visibleFraction({ x: 0, y: 120, width: 400, height: 60 }, [list, VIEWPORT])).toBe(1);
  });
});

describe("visibleSlice", () => {
  test("keeps in-viewport rows, drops below-fold rows, and orders by rank", () => {
    const slice = visibleSlice([
      candidate("b", { x: 0, y: 40, width: 300, height: 60 }, [VIEWPORT], 2),
      candidate("a", { x: 0, y: 0, width: 300, height: 40 }, [VIEWPORT], 1),
      candidate("far", { x: 0, y: 2000, width: 300, height: 60 }, [VIEWPORT], 3),
    ]);
    expect(slice.map((item) => item.solicitation_id)).toEqual(["a", "b"]);
    expect(slice[0]!.rank).toBe(1);
    expect(slice.every((item) => item.visible_fraction > 0)).toBe(true);
  });

  test("a ranker rank that disagrees with rendered order keeps both numbers", () => {
    // Silently reconciling them would hide exactly the defect worth seeing: a
    // ranking whose order the renderer did not actually apply.
    const slice = visibleSlice([
      { ...candidate("a", { x: 0, y: 0, width: 300, height: 40 }, [VIEWPORT], 2), rankSource: "ranker", domPosition: 1 },
    ]);
    expect(slice[0]!.rank).toBe(2);
    expect(slice[0]!.dom_position).toBe(1);
  });

  test("an absent ranking explanation is reported absent, never substituted", () => {
    const [item] = visibleSlice([candidate("a", { x: 0, y: 0, width: 300, height: 40 })]);
    expect(item!.ranking_explanation).toBeNull();
    expect(item!.ranking_explanation_observed).toBe(false);
    expect(item!.rank_source).toBe("dom_order");
  });

  test("a published explanation is carried verbatim and marked observed", () => {
    const [item] = visibleSlice([
      {
        ...candidate("a", { x: 0, y: 0, width: 300, height: 40 }),
        rankSource: "ranker",
        rankingExplanation: "stale escalation, 9 failed repairs",
      },
    ]);
    expect(item!.ranking_explanation).toBe("stale escalation, 9 failed repairs");
    expect(item!.ranking_explanation_observed).toBe(true);
    expect(item!.rank_source).toBe("ranker");
  });
});

describe("ExposureLedger outcomes", () => {
  test("a first exposure is not an outcome of any kind", () => {
    const ledger = new ExposureLedger();
    expect(ledger.tick(["a", "b"])).toEqual([]);
    expect(ledger.exposureCount("a")).toBe(1);
  });

  test("shown twice without an act accumulates shown_not_acted, not two answers", () => {
    const ledger = new ExposureLedger();
    ledger.tick(["a"]);
    const second = ledger.tick(["a"]);
    expect(second).toHaveLength(1);
    expect(second[0]!.outcome).toBe("shown_not_acted");
    expect(second[0]!.exposureCount).toBe(2);
    const third = ledger.tick(["a"]);
    expect(third[0]!.exposureCount).toBe(3);
  });

  test("an act stops the shown_not_acted inference for that id only", () => {
    const ledger = new ExposureLedger();
    ledger.tick(["a", "b"]);
    const act = ledger.act("a", "answered");
    expect(act.outcome).toBe("answered");
    expect(act.scope).toBe("panel");
    expect(act.exposureCount).toBe(1);
    const next = ledger.tick(["a", "b"]);
    expect(next.map((event) => event.solicitationId)).toEqual(["b"]);
  });

  test("declined, complained and answered stay distinct", () => {
    const ledger = new ExposureLedger();
    ledger.tick(["a", "b", "c"]);
    expect(ledger.act("a", "answered").outcome).toBe("answered");
    expect(ledger.act("b", "declined").outcome).toBe("declined");
    expect(ledger.act("c", "complained").outcome).toBe("complained");
  });

  test("an ask-level act keeps its ask id and scope", () => {
    const ledger = new ExposureLedger();
    ledger.tick(["a"]);
    const act = ledger.act("a", "declined", "a1");
    expect(act.scope).toBe("ask");
    expect(act.askId).toBe("a1");
    // The store reads `declined` only when there is no ask id; the record must
    // still be able to tell a per-ask decline from a whole-panel one.
    expect(ledger.act("a", "declined").scope).toBe("panel");
  });

  test("never shown produces no record and no negative", () => {
    const ledger = new ExposureLedger();
    ledger.tick(["a"]);
    ledger.tick(["a"]);
    expect(ledger.exposureCount("unshown")).toBe(0);
    // Nothing in the ledger's output ever mentions an id that was not visible.
    expect(ledger.tick(["a"]).every((event) => event.solicitationId === "a")).toBe(true);
  });
});

describe("record shape", () => {
  const record = buildExposureRecord({
    ...CONDITIONS,
    snapshotCount: 12,
    candidates: [
      candidate("a", { x: 0, y: 0, width: 300, height: 40 }, [VIEWPORT], 1),
      candidate("z", { x: 0, y: 4000, width: 300, height: 40 }, [VIEWPORT], 2),
    ],
    visible: visibleSlice([candidate("a", { x: 0, y: 0, width: 300, height: 40 }, [VIEWPORT], 1)]),
    tickSeq: 1,
    measuredSelector: "[data-solicitation-id]",
  });

  test("machine origin is the first field, so no reader can mistake it for a human contribution", () => {
    expect(Object.keys(record)[0]).toBe("origin");
    expect(record["origin"]).toBe(MACHINE_ORIGIN);
    expect(JSON.stringify(record).startsWith('{"origin":"machine"')).toBe(true);
  });

  test("travels as interactorObservation — never uiFeedback", () => {
    expect(record["type"]).toBe("interactorObservation");
    expect(JSON.stringify(record)).not.toContain("uiFeedback");
  });

  test("no field name claims attention", () => {
    const names = JSON.stringify(record).toLowerCase();
    for (const forbidden of ['"seen', '"viewed', '"read_by', '"noticed', '"attended', '"impression']) {
      expect(names).not.toContain(forbidden);
    }
    expect(record["visible_in_viewport_count"]).toBe(1);
    expect(String(record["claim"])).toContain("intersected the viewport box");
  });

  test("withheld solicitations are denominators, not outcomes", () => {
    expect(record["snapshot_count"]).toBe(12);
    expect(record["candidates_total"]).toBe(2);
    expect(record["not_in_visible_slice_count"]).toBe(1);
    expect(record["outcome"]).toBeUndefined();
    expect(record["scan_status"]).toBe("observed");
  });

  test("presentation conditions actually adopted are carried", () => {
    expect(record["renderer_bundle"]).toBe("index-Dp37Wg-Y.js");
    expect(record["presentation_variant"]).toBe("onepage");
    expect(record["viewport"]).toEqual({ width: 1440, height: 900 });
    expect(record["unobservable"]).toEqual([]);
  });

  test("an unobservable condition is listed, not guessed", () => {
    const blind = buildExposureRecord({
      rendererBundle: null,
      viewport: null,
      presentationVariant: null,
      snapshotCount: 0,
      candidates: [],
      visible: [],
      tickSeq: 2,
      measuredSelector: "[data-solicitation-id]",
    });
    expect(blind["unobservable"]).toEqual(["renderer_bundle", "viewport", "presentation_variant"]);
    expect(blind["renderer_bundle"]).toBeNull();
  });

  test("solicitations present with nothing measurable is a FAILED scan, not an empty one", () => {
    const failed = buildExposureRecord({
      ...CONDITIONS,
      snapshotCount: 425,
      candidates: [],
      visible: [],
      tickSeq: 3,
      measuredSelector: "[data-solicitation-id]",
    });
    expect(failed["scan_status"]).toBe("failed");
    const error = failed["structured_error"] as Record<string, unknown>;
    expect(error["resolver"]).toBe("ui_exposure_reporter");
    expect(String(error["detail"])).toContain("failed scan");
  });

  test("an empty snapshot is observed, not failed — there was nothing to show", () => {
    const empty = buildExposureRecord({
      ...CONDITIONS,
      snapshotCount: 0,
      candidates: [],
      visible: [],
      tickSeq: 4,
      measuredSelector: "[data-solicitation-id]",
    });
    expect(empty["scan_status"]).toBe("observed");
    expect(empty["structured_error"]).toBeUndefined();
  });

  test("outcome records carry origin first, the outcome, and whether it was inferred", () => {
    const ledger = new ExposureLedger();
    ledger.tick(["a"]);
    const answered = buildOutcomeRecord(ledger.act("a", "answered", "a1"), CONDITIONS);
    expect(Object.keys(answered)[0]).toBe("origin");
    expect(answered["obs_type"]).toBe("exposure_outcome");
    expect(answered["panel_id"]).toBe("a");
    expect(answered["ask_id"]).toBe("a1");
    expect(answered["outcome"]).toBe("answered");
    expect(answered["outcome_scope"]).toBe("ask");
    expect(answered["inferred"]).toBe(false);

    const inferred = buildOutcomeRecord(ledger.tick(["b"]).concat(ledger.tick(["b"]))[0]!, CONDITIONS);
    expect(inferred["outcome"]).toBe("shown_not_acted");
    expect(inferred["inferred"]).toBe(true);
    expect(inferred["exposure_count"]).toBe(2);
  });
});
