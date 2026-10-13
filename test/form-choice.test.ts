/**
 * A person's "Show as" choice is evidence the form learner reads: against the
 * form left, for the form chosen. Enough explicit choices of one form promote
 * it for that kind of content; a few never move anything; the route refuses a
 * choice that names no forms.
 */
import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { aggregateFormEvidence, decideLearnedForms, FORM_OBSERVATION_FLOOR } from "../src/form-learn.ts";
import { impulsesRouter } from "../src/routes/impulses.ts";
import { getRenderPolicy } from "../src/store.ts";

const choice = (shape: string, from: string, to: string) => ({ type: "form_choice", body: { shape, form_from: from, form_to: to } });

describe("aggregateFormEvidence with form_choice", () => {
  test("a choice counts against the form left and for the form chosen", () => {
    const { pairs } = aggregateFormEvidence([choice("webSearchResult", "record", "rows")]);
    const by = Object.fromEntries(pairs.map((p) => [p.form, p]));
    expect(by["record"]).toMatchObject({ successes: 0, failures: 1, chosen: 0 });
    expect(by["rows"]).toMatchObject({ successes: 1, failures: 0, chosen: 1 });
  });

  test("an incomplete choice is skipped and said to be skipped", () => {
    const { pairs, skipped } = aggregateFormEvidence([{ type: "form_choice", body: { shape: "x", form_from: "record" } }]);
    expect(pairs).toEqual([]);
    expect(skipped).toContainEqual({ reason: "form_choice_incomplete", count: 1 });
  });
});

describe("decideLearnedForms with people's choices", () => {
  test("enough explicit choices of a form promote it for that shape", () => {
    const recs = Array.from({ length: FORM_OBSERVATION_FLOOR }, () => choice("webSearchResult", "record", "rows"));
    const { pairs } = aggregateFormEvidence(recs);
    const { next, moves } = decideLearnedForms(pairs, {});
    expect(next["webSearchResult"]).toBe("rows");
    expect(moves[0]).toMatchObject({ shape: "webSearchResult", from: null, to: "rows" });
  });

  test("must-fail: fewer choices than the floor move nothing", () => {
    const recs = Array.from({ length: FORM_OBSERVATION_FLOOR - 1 }, () => choice("webSearchResult", "record", "rows"));
    const { next, moves } = decideLearnedForms(aggregateFormEvidence(recs).pairs, {});
    expect(next).toEqual({});
    expect(moves).toEqual([]);
  });
});

describe("the route", () => {
  const app = new Hono();
  app.route("/", impulsesRouter);
  const post = (pointer: Record<string, unknown>) =>
    app.request("/v2/impulses/resolve", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pointer: { type: "interactorObservation", ...pointer } }) });

  test("must-fail: a choice naming no target form, or the same form, is refused", async () => {
    expect((await post({ obs_type: "form_choice", shape: "s", form_from: "record" })).status).toBe(400);
    expect((await post({ obs_type: "form_choice", shape: "s", form_from: "rows", form_to: "rows" })).status).toBe(400);
  });

  test("choices reach the learned table the planner reads", async () => {
    for (let i = 0; i < FORM_OBSERVATION_FLOOR; i++) {
      const r = await post({ obs_type: "form_choice", visibility: "operator_only", shape: "fc_test_shape", form_from: "record", form_to: "prose" });
      expect(r.status).toBe(200);
    }
    expect(getRenderPolicy().learnedFormByShape?.["fc_test_shape"]).toBe("prose");
  });
});
