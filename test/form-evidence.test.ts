/**
 * The form learner's evidence, end to end: a question row carries the form its
 * body is drawn in; an act reads it off the DOM into the outcome record; the
 * record goes through the vessel's own observation write; the learner scores it.
 *
 * Before the row carried `data-form`, this chain broke at the first link and
 * every learning pass reported "no exposure outcome carried a form".
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
const registeredHere = !GlobalRegistrator.isRegistered;
if (registeredHere) GlobalRegistrator.register({ url: "http://surface.test/" });

import { afterAll, describe, expect, test } from "bun:test";
import { buildOutcomeRecord, readDrawnForm, ExposureLedger } from "../ui/src/lib/exposure";
import { impulsesRouter } from "../src/routes/impulses.ts";
import { aggregateFormEvidence, decideLearnedForms, FORM_OBSERVATION_FLOOR } from "../src/form-learn.ts";
import { readExposureCorpus } from "../src/importance-learn.ts";

afterAll(async () => {
  if (registeredHere) await GlobalRegistrator.unregister();
});

const conditions = { rendererBundle: "test-bundle", viewport: { width: 1440, height: 900 }, presentationVariant: "workbench" };

/** What /api/observations forwards: the record whole, typed as an observation. */
async function writeObservation(record: Record<string, unknown>): Promise<number> {
  const res = await impulsesRouter.request("/v2/impulses/resolve", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ impulse: { pointer: { ...record, type: "interactorObservation", visibility: "operator_only" } } }),
  });
  return res.status;
}

describe("form evidence reaches the form learner", () => {
  test("the row is read first; the open card is the fallback; nothing on the page means no form", () => {
    document.body.innerHTML = `
      <button data-solicitation-id="q-row" data-exposure-role="list_row" data-form="prose" data-form-shape="human_question"></button>
      <div data-question-body="q-card" data-form-shape="human_question"><div class="sf-rendered" data-form="record"></div></div>`;
    expect(readDrawnForm(document, "q-row")).toEqual({ form: "prose", shape: "human_question", readFrom: "list_row" });
    expect(readDrawnForm(document, "q-card")).toEqual({ form: "record", shape: "human_question", readFrom: "question_card" });
    expect(readDrawnForm(document, "q-absent")).toBeNull();
  });

  test("an outcome without a drawn form says nothing about form", () => {
    const rec = buildOutcomeRecord(new ExposureLedger().act("q-x", "answered"), conditions);
    expect("form" in rec).toBe(false);
    expect("form_source" in rec).toBe(false);
  });

  test("complaints about a drawn form, written through the vessel, demote it in the learner", async () => {
    const id = `q-e2e-${crypto.randomUUID()}`;
    document.body.innerHTML = `<button data-solicitation-id="${id}" data-exposure-role="list_row" data-form="record" data-form-shape="e2e_shape"></button>`;
    const ledger = new ExposureLedger();
    for (let i = 0; i < FORM_OBSERVATION_FLOOR; i++) {
      const drawn = readDrawnForm(document, id);
      expect(drawn).not.toBeNull();
      const rec = buildOutcomeRecord({ ...ledger.act(id, "complained"), drawn: drawn! }, conditions);
      expect(rec).toMatchObject({ obs_type: "exposure_outcome", form: "record", form_source: "dom", shape: "e2e_shape" });
      expect(await writeObservation(rec)).toBe(200);
    }
    const { pairs } = aggregateFormEvidence(readExposureCorpus() as Record<string, unknown>[]);
    const pair = pairs.find((p) => p.shape === "e2e_shape" && p.form === "record");
    expect(pair?.failures).toBe(FORM_OBSERVATION_FLOOR);
    expect(decideLearnedForms(pairs, {}).next["e2e_shape"]).toBe("text");
  });
});
