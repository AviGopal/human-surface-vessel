/**
 * The form-decision channel, end to end through the real routers.
 *
 * The property under test is not "a POST returns 200" — it is that the four
 * fields a decision needs to be JOINABLE survive the trip, and that the census
 * built from them refuses to report a measurement nobody made.
 */

import { describe, expect, test } from "bun:test";
import { app } from "../src/index.ts";
import { buildUiView } from "../src/ui-view.ts";
import { buildFormCensus } from "../src/form-census.ts";

const RESOLVE = "/v2/impulses/resolve";

async function resolve(pointer: Record<string, unknown>): Promise<{ status: number; body: any }> {
  const res = await app.request(RESOLVE, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ impulse: { pointer } }),
  });
  return { status: res.status, body: await res.json() };
}

function decision(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    shape: "dispatch_id",
    content_signature: "fnv1a32:deadbeef:36",
    form: "scalar",
    decided_by: "rescue",
    policy_revision: 3,
    drawn_chars: 36,
    truncated: false,
    region: "evidence_ledger",
    ...over,
  };
}

describe("the form_decision observation channel", () => {
  test("a decision is accepted and every joinable field is persisted", async () => {
    const posted = await resolve({
      type: "interactorObservation",
      obs_type: "form_decision",
      origin: "browser",
      producer: "ui/src/lib/form-decision.ts",
      tick_seq: 1,
      decisions: [decision()],
      decisions_count: 1,
    });
    expect(posted.status).toBe(200);
    expect(posted.body.success).toBe(true);

    // PERSISTED, not merely accepted. The route's own comment warns that the
    // earlier version of this case kept six named columns and dropped the rest,
    // which would leave a pipeline looking conditioned while it was not — so
    // the assertion is on the stored row, read back.
    const state = await (await app.request("/api/state")).json();
    const rows = state.observations.filter((o: any) => o.type === "form_decision");
    expect(rows.length).toBeGreaterThan(0);
    const stored = rows[0].body.decisions[0];
    expect(stored.shape).toBe("dispatch_id");
    expect(stored.content_signature).toBe("fnv1a32:deadbeef:36");
    expect(stored.form).toBe("scalar");
    expect(stored.decided_by).toBe("rescue");
    expect(stored.policy_revision).toBe(3);
  });

  test("REFUSED: a record with no decisions is not stored as an unusable row", async () => {
    // A corpus of unusable rows looks like evidence. Same rule the route
    // already applies to an exposure_outcome with no panel id.
    for (const decisions of [undefined, [], "not-an-array"]) {
      const res = await resolve({
        type: "interactorObservation",
        obs_type: "form_decision",
        ...(decisions === undefined ? {} : { decisions }),
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain("decisions[]");
    }
  });

  test("the pin and the rescue are DISTINGUISHABLE in the corpus", async () => {
    // The whole reason `decided_by` exists. If these two folded together, the
    // heuristic would take credit for instructions a person typed by hand.
    await resolve({
      type: "interactorObservation",
      obs_type: "form_decision",
      decisions: [
        decision({ decided_by: "pin", form: "terminal", content_signature: "fnv1a32:00000001:9" }),
        decision({ decided_by: "record", form: "record", content_signature: "fnv1a32:00000002:9" }),
      ],
    });
    const census = buildFormCensus();
    expect(census.observed).toBe(true);
    expect(census.by_decided_by?.["pin"]).toBeGreaterThan(0);
    expect(census.by_decided_by?.["rescue"]).toBeGreaterThan(0);
    expect(census.by_decided_by?.["record"]).toBeGreaterThan(0);
  });

  test("the census rides on the self-report the substrate's own detector reads", async () => {
    const view = buildUiView();
    expect(view.content_forms.observed).toBe(true);
    expect(view.content_forms.decisions_total).toBeGreaterThan(0);
    // The standing count for the misroute class. Every decision posted above is
    // either scalar/terminal/record, so nothing should be in the bucket.
    expect(view.content_forms.bare_values_as_verbatim).toBe(0);
  });

  test("the misroute bucket fills when a short value lands on verbatim", async () => {
    // A POSITIVE CONTROL for the bucket. Without this the assertion above is
    // satisfied by a counter that never increments for any input.
    const before = buildFormCensus().bare_values_as_verbatim ?? 0;
    await resolve({
      type: "interactorObservation",
      obs_type: "form_decision",
      decisions: [
        decision({
          form: "text",
          decided_by: "unparsed",
          drawn_chars: 12,
          content_signature: "fnv1a32:00000003:12",
        }),
      ],
    });
    expect(buildFormCensus().bare_values_as_verbatim).toBe(before + 1);
  });
});

describe("not observed is not zero", () => {
  test("an empty corpus yields `observed: false` and NO counts at all", () => {
    const census = buildFormCensus(() => []);
    expect(census.observed).toBe(false);
    // The absence is the assertion. A detector handed a table of zeros reads it
    // as "nothing was drawn badly" and grades the surface clean from a
    // population of runs in which nobody ever looked.
    expect(census.decisions_total).toBeUndefined();
    expect(census.by_form).toBeUndefined();
    expect(census.by_decided_by).toBeUndefined();
    expect(census.bare_values_as_verbatim).toBeUndefined();
  });

  test("records whose decisions are all malformed are NOT a clean census", () => {
    // Rows existed, so a naive `length > 0` check would report a measurement.
    // Nothing usable was in them, so there was no measurement.
    const census = buildFormCensus(() => [
      {
        type: "form_decision",
        visibility: "operator_only",
        observedAt: 1,
        body: { decisions: [1, "two", null] },
      } as never,
    ]);
    expect(census.observed).toBe(false);
  });

  test("POSITIVE CONTROL: the same injected reader DOES report a well-formed row", () => {
    // Without this, both assertions above pass for a `buildFormCensus` that
    // always returns `observed: false` — the injection point itself has to be
    // shown capable of a positive result.
    const census = buildFormCensus(() => [
      {
        type: "form_decision",
        visibility: "operator_only",
        observedAt: 7,
        body: { decisions: [decision()] },
      } as never,
    ]);
    expect(census.observed).toBe(true);
    expect(census.decisions_total).toBe(1);
    expect(census.last_observed_at).toBe(7);
  });
});
