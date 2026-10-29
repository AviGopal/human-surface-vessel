/**
 * `content_forms.recent_briefs` is always a list.
 *
 * A reader asking "which briefs did this surface draw, and for which run" must
 * get a list it can search on every node — including one where no page has
 * reported a form decision yet. Both cold returns of the census carry `[]`,
 * while `observed` keeps saying whether anyone looked.
 */

import { describe, expect, test } from "bun:test";
import { buildFormCensus } from "../src/form-census.ts";
import type { Observation } from "../src/store.ts";

function obs(at: number, decisions: unknown[]): Observation {
  return { type: "form_decision", visibility: "operator_only", observedAt: at, body: { decisions } } as unknown as Observation;
}

const recordRow = { shape: "s", content_signature: "fnv1a32:0000000a:4", form: "record", decided_by: "record", region: "run_answer" };

describe("recent_briefs is always a list", () => {
  test("[MUST-FAIL] no form decisions at all: recent_briefs is [] and observed stays false", () => {
    const census = buildFormCensus(() => []);
    expect(Array.isArray(census.recent_briefs)).toBe(true);
    expect(census.recent_briefs.length).toBe(0);
    expect(census.observed).toBe(false);
    expect(census.decisions_total).toBeUndefined();
  });

  test("[MUST-FAIL] records whose rows are all unusable: recent_briefs is [] and observed stays false", () => {
    const census = buildFormCensus(() => [obs(1, [1, "two", null])]);
    expect(Array.isArray(census.recent_briefs)).toBe(true);
    expect(census.recent_briefs.length).toBe(0);
    expect(census.observed).toBe(false);
    expect(census.decisions_total).toBeUndefined();
  });

  test("CONTROL: one non-brief decision is observed and lists no briefs", () => {
    const census = buildFormCensus(() => [obs(5, [recordRow])]);
    expect(census.observed).toBe(true);
    expect(census.recent_briefs).toEqual([]);
  });

  test("CONTROL: a brief decision is still listed with its run and region, newest first", () => {
    const census = buildFormCensus(() => [
      obs(10, [{ ...recordRow, form: "brief", decided_by: "brief", dispatch_id: "run-a" }]),
      obs(20, [{ ...recordRow, form: "brief", decided_by: "brief", dispatch_id: "run-b" }]),
    ]);
    expect(census.recent_briefs).toEqual([
      { dispatch_id: "run-b", region: "run_answer", at: 20 },
      { dispatch_id: "run-a", region: "run_answer", at: 10 },
    ]);
  });

  test("CONTROL: the other census fields are unchanged on the observed path", () => {
    const census = buildFormCensus(() => [obs(5, [recordRow]), obs(9, [{ ...recordRow, content_signature: "fnv1a32:0000000b:4", form: "text", decided_by: "unparsed", region: "evidence_ledger" }])]);
    expect(census).toEqual({
      observed: true,
      decisions_total: 2,
      distinct_payloads: 2,
      distinct_shapes: 1,
      by_form: { record: 1, text: 1 },
      by_decided_by: { record: 1, unparsed: 1 },
      by_region: { run_answer: 1, evidence_ledger: 1 },
      bare_values_as_verbatim: 0,
      last_observed_at: 9,
      recent_briefs: [],
      window: census.window,
    });
    expect(typeof census.window).toBe("number");
  });
});
