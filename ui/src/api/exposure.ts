/**
 * Transport for the exposure record.
 *
 * ONE SHAPE, REUSED. These records travel as `interactorObservation` — a shape
 * this vessel already advertises (src/config.ts:66) and already serves
 * (src/routes/impulses.ts:342). development-vessel's interactor passthrough
 * states the licence explicitly: "The other interactor_* shapes are
 * unconstrained append-only observation channels and are deliberately left
 * alone" (src/resolvers/interactor-passthrough.ts:70). Minting an
 * `uiExposure` shape would have split the observation channel for no capability
 * the existing one cannot express.
 *
 * NOT `uiFeedback`, EVER. That channel is human contributions only, and it
 * carries a refusal guard added after 48 machine-written records polluted the
 * operator-verdict corpus and manufactured a false reach class
 * (development-vessel/src/resolvers/interactor-passthrough.ts:72-90). Every
 * record sent from here is machine-origin by construction, so it may not go
 * there. Nothing in this file posts to /api/feedback.
 *
 * ENDPOINT CONTRACT (server side owned by another agent this phase):
 *   POST /api/observations  — body is the pointer object, including
 *   `type: "interactorObservation"`. Expected to self-post the shape through
 *   RESOLVE_PATH exactly as POST /api/feedback does for `uiFeedback`
 *   (src/routes/proxy.ts:1009-1034). Until it exists the browser's POST 404s,
 *   which is why every send here is fire-and-forget: a missing recorder must
 *   degrade the record, never the person's session.
 *
 * WHAT THE SERVER SIDE STILL HAS TO ACCEPT (contract, not a suggestion):
 *
 *   1. `OBSERVATION_TYPES` (src/routes/impulses.ts:89) gains `"exposure"` and
 *      `"exposure_outcome"`; `Observation` (src/store.ts:56) gains the same two
 *      to its `type` union. Both files are owned elsewhere this phase, so this
 *      is stated rather than done. Until then the resolver 400s with
 *      "obs_type required, one of click, dwell, scroll, focus".
 *
 *   2. The pointer fields must be PERSISTED, not dropped. The existing
 *      `interactorObservation` case keeps only type/panel_id/ask_id/
 *      duration_ms/position/visibility, so every field below would be
 *      silently discarded — a pipeline that looks conditioned and is not.
 *      obs_type "exposure": origin, producer, tick_seq, scan_status,
 *      structured_error?, visible_in_viewport[{solicitation_id, rank,
 *      rank_source, ranking_explanation, ranking_explanation_observed,
 *      element_role, dom_position, visible_fraction}],
 *      visible_in_viewport_count, snapshot_count, candidates_total,
 *      not_in_visible_slice_count, renderer_bundle, viewport,
 *      presentation_variant, measured_selector, claim, unobservable[].
 *      obs_type "exposure_outcome": origin, producer, panel_id, ask_id,
 *      outcome (answered|declined|complained|shown_not_acted), outcome_scope
 *      (panel|ask), exposure_count, inferred, renderer_bundle, viewport,
 *      presentation_variant.
 *
 *   3. DURABILITY IS UNSOLVED AND MUST BE NAMED, not assumed. `recordObservation`
 *      is a bounded in-memory array capped at MAX_HISTORY = 500, oldest entry
 *      shifted out (src/store.ts:100,
 *      :315), and development-vessel's interactor passthrough has no
 *      `interactorObservation_write` channel at all — so today these records
 *      die with the process and a learner reading them would train on a window
 *      it cannot bound. The wiring agent chooses the append-only journal
 *      (`src/participation-journal.ts` already fsyncs `uiPanel_write` /
 *      `uiFeedback_write`; a third channel is the obvious extension).
 *
 *   4. READERS. Immediate: the importance learner built in this same workflow
 *      (src/importance.ts weights, which currently have no evidence source).
 *      Existing: `recentObservations` (src/store.ts:320) surfaced on GET
 *      /api/state (src/index.ts:84).
 */

const ENDPOINT = "/api/observations";

export type ExposureSender = (record: Record<string, unknown>) => void;

/**
 * Fire-and-forget by design, with one exception to the usual rule: the failure
 * is logged IN the catch rather than success being logged at initiation, so a
 * silently dropped record cannot read as a recorded one.
 */
export function sendObservation(record: Record<string, unknown>): void {
  void fetch(ENDPOINT, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(record),
  })
    .then((response) => {
      if (!response.ok) {
        console.warn(
          `[exposure] ${ENDPOINT} rejected an ${String(record["obs_type"])} record (HTTP ${response.status}); ` +
            `this tick is absent from the exposure corpus`,
        );
      }
    })
    .catch((error: unknown) => {
      console.warn(`[exposure] ${ENDPOINT} unreachable; this tick is absent from the exposure corpus`, error);
    });
}
