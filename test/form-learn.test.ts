/**
 * The form learner's two rules: never-shown moves nothing, and the only move
 * is a bounded demotion to the verbatim default — lifted again on recovery.
 */
import { describe, expect, test } from "bun:test";
import { aggregateFormEvidence, decideLearnedForms, FORM_OBSERVATION_FLOOR } from "../src/form-learn.ts";

const outcome = (form: string | null, outcome: string, source = "dom", shape = "shellResult") => ({
  type: "exposure_outcome",
  outcome,
  body: { ...(form ? { form, form_source: source } : {}), shape },
});

describe("form learner", () => {
  test("records without a DOM-read form are skipped and counted, not scored", () => {
    const { pairs, skipped } = aggregateFormEvidence([outcome(null, "answered"), outcome("record", "answered", "guess")]);
    expect(pairs).toEqual([]);
    expect(skipped).toEqual([{ reason: "no_form_on_record", count: 2 }]);
  });

  test("declines and inferred outcomes are not about the form", () => {
    const { pairs } = aggregateFormEvidence([outcome("record", "declined"), outcome("record", "shown_not_acted")]);
    expect(pairs).toEqual([]);
  });

  test("below the floor nothing moves; at the floor a complained-about form falls back to text", () => {
    const few = aggregateFormEvidence(Array.from({ length: FORM_OBSERVATION_FLOOR - 1 }, () => outcome("record", "complained"))).pairs;
    expect(decideLearnedForms(few, {}).moves).toEqual([]);
    const many = aggregateFormEvidence(Array.from({ length: FORM_OBSERVATION_FLOOR }, () => outcome("record", "complained"))).pairs;
    const d = decideLearnedForms(many, {});
    expect(d.next).toEqual({ shellResult: "text" });
    expect(d.moves[0]?.to).toBe("text");
  });

  test("a shape with no evidence keeps its learned entry byte-identical", () => {
    expect(decideLearnedForms([], { other: "text" }).next).toEqual({ other: "text" });
  });

  test("recovery above the threshold lifts a prior demotion", () => {
    const good = aggregateFormEvidence(Array.from({ length: FORM_OBSERVATION_FLOOR + 2 }, () => outcome("record", "answered"))).pairs;
    const d = decideLearnedForms(good, { shellResult: "text" });
    expect(d.next).toEqual({});
    expect(d.moves[0]?.to).toBeNull();
  });

  test("complaints about the fallback itself move nothing — there is nowhere lower", () => {
    const pairs = aggregateFormEvidence(Array.from({ length: FORM_OBSERVATION_FLOOR }, () => outcome("text", "complained"))).pairs;
    expect(decideLearnedForms(pairs, {}).moves).toEqual([]);
  });
});
