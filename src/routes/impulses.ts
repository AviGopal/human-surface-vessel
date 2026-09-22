/**
 * POST /v2/impulses/resolve — the shaped resolver surface.
 *
 * HARD INVARIANT: the `switch (pointer.type)` below and `DISCOVERY_SHAPES` in
 * `../config.ts` must agree EXACTLY. The invariant is made structural rather
 * than documentary two ways:
 *   1. every case label is typed as `DiscoveryShape`, so a case naming a shape
 *      that is not advertised fails to typecheck;
 *   2. `assertExhaustive` in the default branch fails to typecheck if any
 *      advertised shape lacks a case.
 * The 400 body reports `supported_shapes: DISCOVERY_SHAPES` verbatim, so a
 * caller sees the advertised vocabulary, never a hand-copied list.
 */

import { Hono } from "hono";
import { DISCOVERY_SHAPES, METABOB_API_KEY, type DiscoveryShape } from "../config.ts";
import {
  asVisibility,
  recordAssertion,
  recordAttachment,
  recordEvent,
  recordFeedback,
  recordObservation,
  upsertPanel,
  getPanel,
  listPanels,
  questionView,
  isSolicitation,
  ParticipationConflict,
  type Ask,
  type InteractorEvent,
  type Observation,
  type ExposureOutcome,
  getRenderPolicy,
  writeRenderPolicy,
  RENDER_POLICY_PATCH_KEYS,
  recordSurfaceIntent,
} from "../store.ts";
import { explainRanking, rankPanels, type ImportanceWeights } from "../importance.ts";
import { MIN_KIND_WEIGHT, runImportanceLearningPass } from "../importance-learn.ts";
import { GRAMMAR, readSurfaceIntent } from "../surface-intent.ts";

type Pointer = Record<string, unknown>;

const SHAPE_SET: ReadonlySet<string> = new Set<string>(DISCOVERY_SHAPES);

function isDiscoveryShape(t: unknown): t is DiscoveryShape {
  return typeof t === "string" && SHAPE_SET.has(t);
}

/** Compile-time proof that the switch covers every advertised shape. */
function assertExhaustive(_never: never): void {
  /* unreachable at runtime */
}

function str(p: Pointer, key: string, fallback: string): string {
  const v = p[key];
  return typeof v === "string" ? v : fallback;
}

function optStr(p: Pointer, key: string): string | undefined {
  const v = p[key];
  return typeof v === "string" ? v : undefined;
}

function optNum(p: Pointer, key: string): number | undefined {
  const v = p[key];
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function optBody(p: Pointer, key: string): Record<string, unknown> | undefined {
  const v = p[key];
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
}

function optPosition(p: Pointer): { x: number; y: number } | undefined {
  const v = optBody(p, "position");
  if (!v) return undefined;
  const x = v["x"];
  const y = v["y"];
  return typeof x === "number" && typeof y === "number" ? { x, y } : undefined;
}

/**
 * The panel fields a write can carry. Used twice in the write path: to decide
 * whether a write over an existing panel carries any content at all, and (field
 * by field) to decide default-vs-preserve. Keep the two in step.
 */
const PANEL_CONTENT_KEYS = ["title", "body", "kind", "importance", "asks", "visibility"] as const;

/**
 * `exposure` and `exposure_outcome` are the exposure corpus — what the surface
 * put on screen and what became of it. They arrive on `interactorObservation`
 * (the channel already advertised and served here) rather than on a minted
 * shape, which is what ui/src/api/exposure.ts posts and what the importance
 * learner reads.
 */
const OBSERVATION_TYPES = [
  "click",
  "dwell",
  "scroll",
  "focus",
  "exposure",
  "exposure_outcome",
  /**
   * WHICH FORM THE SURFACE CHOSE FOR A PAYLOAD, AND WHICH BRANCH CHOSE IT.
   *
   * On the same channel as the exposure corpus, for the same reason: it is an
   * unconstrained append-only observation channel this vessel already
   * advertises and serves, and a `uiFormDecision` shape would split the channel
   * for no capability it cannot express (law 3).
   *
   * It is the PREREQUISITE for any form learning, not the learning itself.
   * Until this existed, the surface decided how to draw every impulse and
   * recorded nothing about having decided — so there was no decision for a
   * reward to attach to, whichever mechanism eventually supplies the reward.
   */
  "form_decision",
] as const;
const EXPOSURE_OUTCOMES = ["answered", "declined", "complained", "shown_not_acted"] as const;

/**
 * Pointer keys the observation case consumes into named columns. Everything
 * else on an exposure pointer is persisted VERBATIM under `body` — the record
 * carries `visible_in_viewport[]`, `renderer_bundle`, `candidates_total`,
 * `unobservable[]` and more, and the previous version of this case kept six
 * fields and dropped the rest, which would have left the learner's corpus
 * unable to say what conditions produced an outcome.
 */
const OBSERVATION_COLUMN_KEYS = new Set([
  "type",
  "obs_type",
  "observation_type",
  "event_type",
  "kind",
  "panel_id",
  "panelId",
  "ask_id",
  "askId",
  "duration_ms",
  "durationMs",
  "position",
  "visibility",
  "outcome",
  "outcome_scope",
  "outcomeScope",
  "exposure_count",
  "exposureCount",
  "inferred",
  "scan_status",
  "scanStatus",
]);

function exposureOutcome(p: Pointer): ExposureOutcome | undefined {
  const v = p["outcome"];
  return (EXPOSURE_OUTCOMES as readonly string[]).includes(String(v))
    ? (v as ExposureOutcome)
    : undefined;
}

function observationBody(p: Pointer): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(p)) {
    if (OBSERVATION_COLUMN_KEYS.has(k)) continue;
    out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
const EVENT_TYPES = ["click", "dismiss", "expand", "collapse", "focus", "fetch"] as const;
const FEEDBACK_KINDS = ["answer", "reaction", "dismiss"] as const;

function observationType(p: Pointer): Observation["type"] | undefined {
  const v = p["obs_type"] ?? p["observation_type"] ?? p["event_type"] ?? p["kind"];
  return (OBSERVATION_TYPES as readonly string[]).includes(String(v))
    ? (v as Observation["type"])
    : undefined;
}

function eventType(p: Pointer): InteractorEvent["type"] | undefined {
  const v = p["event_type"] ?? p["kind"] ?? p["action"];
  return (EVENT_TYPES as readonly string[]).includes(String(v))
    ? (v as InteractorEvent["type"])
    : undefined;
}

function feedbackKind(p: Pointer): "answer" | "reaction" | "dismiss" {
  const v = p["kind"] ?? p["feedback_kind"];
  return (FEEDBACK_KINDS as readonly string[]).includes(String(v))
    ? (v as "answer" | "reaction" | "dismiss")
    : "answer";
}

function asks(p: Pointer): Ask[] | undefined {
  const v = p["asks"];
  if (!Array.isArray(v)) return undefined;
  const seen = new Set<string>();
  return v.filter((a): a is Ask => {
    if (!a || typeof a !== "object" || typeof a.id !== "string" ||
        typeof a.prompt !== "string" || seen.has(a.id)) return false;
    seen.add(a.id);
    return true;
  }).map(a => ({
    id: a.id, prompt: a.prompt,
    type: ["text", "choice", "number"].includes(a.type) ? a.type : "text",
    ...(Array.isArray(a.choices) ? { choices: a.choices.filter(c => typeof c === "string") } : {}),
  }));
}


/**
 * Read the ranking weights out of a `renderPolicy_write` pointer.
 *
 * Accepted in camelCase and snake_case for the reason stated at the attribution
 * fields below: this vessel's own callers write camelCase while substrate
 * impulses are snake_cased, and a caller whose key spelling is silently dropped
 * is the hollow acceptance this route was repaired for.
 *
 * Every input this parser could not use is pushed onto `rejected` and reported
 * back to the caller. A learner whose weight table arrives half-read must be
 * told which half, or it will grade an order it did not choose. Dropping a bad
 * entry silently would be the same defect as the nested-`policy` 200.
 */
function importanceWeightsPatch(
  pointer: Pointer,
  rejected: string[],
): Partial<ImportanceWeights> | undefined {
  const raw = optBody(pointer, "importanceWeights") ?? optBody(pointer, "importance_weights");
  if (!raw) {
    // Named, not ignored: a non-object under a key this route reads is a caller
    // error worth reporting rather than a silent no-op.
    const present = pointer["importanceWeights"] ?? pointer["importance_weights"];
    if (present !== undefined) rejected.push("importanceWeights must be an object of weight fields");
    return undefined;
  }
  const pick = (...keys: string[]): unknown => {
    for (const key of keys) if (Object.hasOwn(raw, key)) return raw[key];
    return undefined;
  };
  const numberMap = (value: unknown, label: string): Record<string, number> | undefined => {
    if (value === undefined) return undefined;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      rejected.push(`${label} must be an object mapping keys to numbers`);
      return undefined;
    }
    const out: Record<string, number> = {};
    const entries = Object.entries(value as Record<string, unknown>);
    for (const [key, entry] of entries) {
      if (typeof entry !== "number" || !Number.isFinite(entry)) {
        rejected.push(`${label}.${key} is not a finite number`);
        continue;
      }
      // A KIND WEIGHT MAY NOT BE DRIVEN TO ZERO OR BELOW.
      //
      // Finite was not a sufficient guard. A write of byKind {someKind: -1000}
      // was accepted and put in force; the kind then sorted last, was cut by
      // every slice, was therefore never shown, therefore produced no outcome
      // record — and the learner's floor applies only to kinds it MOVES, so
      // nothing could ever lift it again. Verified before this change: five
      // learning passes left such a weight at exactly -1000. That is the same
      // irreversibility class as a type scale that could be flattened and never
      // recover, rebuilt one layer down: the learner is careful and the impulse
      // that feeds it was not.
      //
      // Refused rather than silently clamped, because a caller who asked for
      // an invisible kind should be told the request was not honoured. The
      // floor matches the learner's own MIN_KIND_WEIGHT so the two agree.
      if (label.endsWith("byKind") && entry < MIN_KIND_WEIGHT) {
        rejected.push(
          `${label}.${key} (${entry}) is below the minimum weight ${MIN_KIND_WEIGHT} — a kind at or below zero is never shown, so it can never earn its way back`,
        );
        continue;
      }
      out[key] = entry;
    }
    // A map whose every entry was junk is NOT applied. A supplied map replaces
    // the one in force wholly, so applying the empty survivor would read as
    // "clear the table" — a caller who fat-fingered one weight would silently
    // destroy the whole ranking. Clearing stays possible, but only by asking for
    // it: an explicitly empty object.
    if (entries.length > 0 && Object.keys(out).length === 0) {
      rejected.push(
        `${label} had no usable entry, so it was not applied and the table in force is unchanged (send {} if you mean to clear it)`,
      );
      return undefined;
    }
    return out;
  };
  const scalar = (value: unknown, label: string): number | undefined => {
    if (value === undefined) return undefined;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    rejected.push(`${label} is not a finite number`);
    return undefined;
  };
  const byKind = numberMap(pick("byKind", "by_kind"), "importanceWeights.byKind");
  const declaredImportance = numberMap(
    pick("declaredImportance", "declared_importance"),
    "importanceWeights.declaredImportance",
  );
  const agePerDay = scalar(pick("agePerDay", "age_per_day"), "importanceWeights.agePerDay");
  const unansweredBoost = scalar(
    pick("unansweredBoost", "unanswered_boost"),
    "importanceWeights.unansweredBoost",
  );
  const patch: Partial<ImportanceWeights> = {
    ...(byKind ? { byKind } : {}),
    ...(declaredImportance ? { declaredImportance } : {}),
    ...(agePerDay !== undefined ? { agePerDay } : {}),
    ...(unansweredBoost !== undefined ? { unansweredBoost } : {}),
  };
  return Object.keys(patch).length > 0 ? patch : undefined;
}

/**
 * Read the payload slice size. `null` is a value, not an absence: it means "no
 * slice — return every ranked solicitation". A negative or fractional size is
 * refused and named rather than rounded into something the caller did not ask
 * for.
 */
function visibleSliceSizePatch(
  pointer: Pointer,
  rejected: string[],
): number | null | undefined {
  const raw = Object.hasOwn(pointer, "visibleSliceSize")
    ? pointer["visibleSliceSize"]
    : Object.hasOwn(pointer, "visible_slice_size")
      ? pointer["visible_slice_size"]
      : undefined;
  if (raw === undefined) return undefined;
  if (raw === null) return null;
  if (typeof raw === "number" && Number.isInteger(raw) && raw >= 0) return raw;
  rejected.push("visibleSliceSize must be null (no slice) or a non-negative integer");
  return undefined;
}

const DEV_VESSEL_ENDPOINT = (
  process.env["DEV_VESSEL_ENDPOINT"] ?? "http://127.0.0.1:8090"
).replace(/\/+$/, "");

/**
 * File a human complaint as a substrateGap, keyed exactly as the substrate's own
 * legibility detector keys its findings.
 *
 * `source: "human_reported"` is the only field that distinguishes it, and it is
 * load-bearing: the detector is permitted to CLOSE its own findings on
 * re-observation, and must never close a human's, because the human saw
 * something the detector's rules cannot express.
 */
async function fileFeedbackGap(entry: {
  panelId: string;
  kind: string;
  complaintKind: string;
  value: unknown;
}): Promise<void> {
  const slug = String(entry.panelId)
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  const text = typeof entry.value === "string" ? entry.value : JSON.stringify(entry.value);
  await fetch(`${DEV_VESSEL_ENDPOINT}/v2/impulses/resolve`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(METABOB_API_KEY ? { Authorization: `ApiKey ${METABOB_API_KEY}` } : {}),
    },
    body: JSON.stringify({
      impulse: {
        pointer: {
          type: "substrateGap_write",
          gap: {
            id: `ui-feedback-${slug}-${entry.complaintKind}`,
            category: "ui_legibility",
            source: "human_reported",
            status: "open",
            summary: `UI feedback (${entry.complaintKind}) on ${entry.panelId}: ${text}`,
            detected_at: new Date().toISOString(),
            classification_metadata: {
              surface: "human-surface-vessel",
              region: entry.panelId,
              kind: entry.complaintKind,
              interaction: entry.kind,
            },
          },
        },
      },
    }),
    signal: AbortSignal.timeout(8_000),
  });
}

export const impulsesRouter = new Hono();

impulsesRouter.post("/v2/impulses/resolve", async (c) => {
  const body = (await c.req.json().catch(() => null)) as null | {
    impulse?: { pointer?: Pointer };
    pointer?: Pointer;
  };

  // Accept both envelopes the fleet uses.
  const pointer: Pointer = body?.impulse?.pointer ?? body?.pointer ?? {};
  const type = pointer["type"];

  if (!isDiscoveryShape(type)) {
    return c.json(
      {
        resolved: false,
        success: false,
        error: `unknown shape '${type === undefined ? "undefined" : String(type)}'`,
        supported_shapes: DISCOVERY_SHAPES,
      },
      400,
    );
  }

  switch (type) {
    case "uiPanel_write":
    case "uiQuestion_write": {
      const id = str(pointer, "id", `panel-${Date.now()}`);
      const existing = getPanel(id);

      // (2) REFUSE a contentless write over existing content.
      //
      // The absence-preservation below (1) alone would turn a defaulted write
      // (`{type, id}` and nothing else — what an LLM-defaulted satisfier step
      // emits) into a no-op, and upsertPanel's no-op short-circuit would then
      // return success with the unchanged revision. The walk would record a
      // GREEN step for a write that carried nothing: destruction traded for
      // hollowness. Refusing loudly is what lets the caller fall through to
      // bridge/escalate instead of believing it asked a human something.
      //
      // Exists-only by construction: a fresh id still creates with the literal
      // defaults, because a first write with no content is the caller saying
      // "make a blank panel here", not overwriting anything.
      //
      // `visibility` counts as content-bearing: a visibility-only update is a
      // real, intentional state change (public ↔ operator_only) and refusing it
      // would break a legitimate write.
      if (existing && !PANEL_CONTENT_KEYS.some(k => Object.hasOwn(pointer, k))) {
        return c.json({
          resolved: false,
          success: false,
          shape: type,
          error: `contentless write refused: panel '${id}' already exists and this ${type} carried no content-bearing field (${PANEL_CONTENT_KEYS.join(", ")}). Nothing was changed. Supply the field(s) you intend to write, or read the panel instead of rewriting it.`,
        }, 409);
      }

      // (1) ABSENCE PRESERVES. `Object.hasOwn` is the only form that tells
      // "field omitted" apart from "field explicitly empty": an explicit
      // `body: ""` must still clear the body, while an omitted body on an
      // existing panel must keep what is stored. `??` collapses the two.
      // Literal defaults apply ONLY when there is no existing panel.
      const panel = upsertPanel({
        id,
        title: Object.hasOwn(pointer, "title")
          ? str(pointer, "title", existing?.title ?? "Untitled")
          : (existing?.title ?? "Untitled"),
        body: Object.hasOwn(pointer, "body")
          ? pointer["body"]
          : (existing ? existing.body : ""),
        kind: Object.hasOwn(pointer, "kind")
          ? str(pointer, "kind", existing?.kind ?? (type === "uiQuestion_write" ? "question" : "info"))
          : (existing?.kind ?? (type === "uiQuestion_write" ? "question" : "info")),
        importance: Object.hasOwn(pointer, "importance")
          ? str(pointer, "importance", existing?.importance ?? "medium")
          : (existing?.importance ?? "medium"),
        asks: Object.hasOwn(pointer, "asks") ? asks(pointer) : existing?.asks,
        visibility: Object.hasOwn(pointer, "visibility")
          ? asVisibility(pointer["visibility"], existing?.visibility ?? "public")
          : (existing?.visibility ?? "public"),
      });
      return c.json({ resolved: true, success: true, shape: type, body: panel });
    }

    case "uiQuestion": {
      const wanted = optStr(pointer, "id") ?? optStr(pointer, "panel_id");
      const questions = listPanels()
        // Everything that ASKS a human something, not only kind==="question".
        // The escalation kinds gap-to-feature.ts emits (gap_needs_human, …) were
        // written to this surface and then filtered back out of the only read
        // path the browser has, so the human was never shown what the substrate
        // had escalated. `isSolicitation` is the store's single predicate for
        // this; the answer guard reads the same one, which is the whole reason
        // it had to be fixed FIRST — a reader-only fix shows a human an
        // escalation and then tells them "the question changed" when they
        // answer it.
        .filter(pn => isSolicitation(pn) && (!wanted || pn.id === wanted))
        .map(questionView);

      // ORDERED BY IMPORTANCE, from the impulse, at request time.
      //
      // `listPanels()` sorts by `updatedAt` descending, which orders the wall by
      // whatever the substrate touched most recently — and the substrate's own
      // re-escalation loop touches exactly the items that have been ignored
      // longest, so recency ranks the stale escalations it manufactured. The
      // weights come off the renderPolicy impulse HERE, on every request:
      // nothing in this file imports a weight table, so a learner changes what a
      // human is shown first by writing the impulse, with no rebuild and no
      // restart. That is the whole law-1 requirement, and
      // test/importance-ranking.test.ts is its falsifier.
      const policy = getRenderPolicy();
      const rejected: string[] = [];
      // A caller may ask for a different slice than the policy's. It is a
      // per-request value carried in the pointer (so it is visible in a trace),
      // and the response says which source was used — a request override must
      // never be able to masquerade as the policy in force. It exists because a
      // shaped read that truncates with no way to ask for the rest loses
      // information a machine caller has no recourse for.
      const requestedSlice = visibleSliceSizePatch(pointer, rejected);
      const sliceSource = requestedSlice === undefined ? "policy" : "request";
      const sliceSize = requestedSlice === undefined ? policy.visibleSliceSize : requestedSlice;

      const ranked = rankPanels(questions, policy.importanceWeights, Date.now());
      const shown = sliceSize === null ? ranked : ranked.slice(0, sliceSize);
      const byId = new Map(questions.map((q) => [q.id, q]));
      const sliced = shown.flatMap((scored, index) => {
        const view = byId.get(scored.panel.id);
        // `rank` is the position in the WHOLE ranked set, and the slice is a
        // prefix of it, so index+1 is that position — not merely a position
        // within the slice.
        return view ? [{ ...view, rank: index + 1, because: scored.because }] : [];
      });

      return c.json({
        resolved: true,
        success: true,
        shape: type,
        body: {
          // The slice, highest importance first. Each row carries its rank and
          // the reasons it holds that rank, so a human has something concrete to
          // disagree with. READERS, named by what they do rather than by a line
          // number that a neighbouring edit invalidates: the `data-rank` /
          // `data-rank-explanation` spreads in
          // ui/src/components/ParticipationRegion.tsx (currently :257-258)
          // publish them onto the row, and `collectCandidates` in
          // ui/src/lib/exposure.ts (currently :352-358) reads them back off the
          // element into the exposure record's rank / rank_source /
          // ranking_explanation.
          questions: sliced,
          // UNCHANGED MEANING: every solicitation this read matched, not the
          // size of the slice above. A caller that compares the two can tell a
          // slice from the whole, which is the point.
          total: ranked.length,
          // Also over the whole matched set, never the slice: how many questions
          // are waiting on a human is not a fact about what fitted in a payload.
          unanswered: questions.filter((q) => !q.answered && !q.declined).length,
          /**
           * The honest summary. Truncation is stated, not implied: a caller
           * seeing `not_shown_count > 0` knows there is more and knows how much.
           * `slice_source` names WHERE the size came from, and `policy_revision`
           * identifies the weights that produced this order, so an order can be
           * replayed against the impulse that caused it.
           */
          ranking: {
            solicitations_total: ranked.length,
            shown_count: sliced.length,
            not_shown_count: Math.max(0, ranked.length - sliced.length),
            slice_size: sliceSize,
            slice_source: sliceSource,
            policy_revision: policy.revision,
            weights: policy.importanceWeights,
            explanation: explainRanking(ranked, sliceSize === null ? undefined : sliceSize),
            ...(rejected.length > 0 ? { rejected_values: rejected } : {}),
          },
        },
      });
    }

    case "uiFeedback": {
      const panelId = optStr(pointer, "panel_id") ?? optStr(pointer, "panelId");
      if (!panelId) {
        return c.json(
          { resolved: false, success: false, shape: type, error: "panel_id required" },
          400,
        );
      }
      // response_id is REQUIRED: the store's idempotency (return the identical
      // prior record on a repeat, 409 on same-id-different-content) only
      // engages when the caller names its submission. Without it every re-POST
      // minted a fresh receipt id + timestamp — the 2026-09-21 lifecycle
      // audit's "repeated response produced a different receipt" finding. The
      // browser always sends one (crypto.randomUUID()); do NOT derive one by
      // hashing content — two humans giving the same answer must not collide.
      const responseId = optStr(pointer, "response_id");
      if (!responseId) {
        return c.json(
          { resolved: false, success: false, shape: type, error: "response_id required" },
          400,
        );
      }
      let entry;
      try {
        entry = recordFeedback({
        id: responseId,
        panelRevision: optNum(pointer, "panel_revision"),
        panelId,
        askId: optStr(pointer, "ask_id") ?? optStr(pointer, "askId"),
        value: pointer["value"],
        kind: feedbackKind(pointer),
        visibility: asVisibility(pointer["visibility"], "public"),
      });
      } catch (error) {
        if (error instanceof ParticipationConflict) {
          return c.json({ resolved: false, success: false, error: error.message }, 409);
        }
        throw error;
      }
      // ONE FUNNEL. A human complaint about this surface is filed into the SAME
      // keyspace the substrate's own `ui_legibility_scan` files into —
      // `ui-feedback-<region>-<kind>` — differing only in `source`. That is the
      // whole point of the shared key: a detector that files into its own
      // private list can never be compared against what humans actually notice,
      // and agreement or disagreement between the two is the only signal that
      // says whether the detector's rules match the thing people complain about.
      //
      // Fire-and-forget: a gap-store outage must not lose the complaint, and the
      // in-memory record above has already succeeded.
      // The complaint CATEGORY is distinct from the store's interaction enum.
      // `Feedback.kind` is answer|reaction|dismiss — what the human DID with an
      // ask. A complaint category is hard_to_see|hard_to_understand|wrong — what
      // is WRONG. Collapsing them keyed every complaint about a region as
      // `...-answer`, so two different problems with the same region collided on
      // one gap id and the second silently overwrote the first.
      const complaintKind = optStr(pointer, "complaint_kind");
      // Answering or declining a question is not a complaint about the interface.
      if (complaintKind) void fileFeedbackGap({ ...entry, complaintKind }).catch(() => {});
      return c.json({ resolved: true, success: true, shape: type, body: entry });
    }

    case "interactorObservation": {
      const obsType = observationType(pointer);
      if (!obsType) {
        return c.json(
          {
            resolved: false,
            success: false,
            shape: type,
            error: `obs_type required, one of ${OBSERVATION_TYPES.join(", ")}`,
          },
          400,
        );
      }
      const panelId = optStr(pointer, "panel_id") ?? optStr(pointer, "panelId");
      const outcome = exposureOutcome(pointer);
      // An outcome record with no panel id, or with an outcome this vessel does
      // not recognise, is REFUSED rather than stored as a record the learner
      // will then skip. A corpus full of unusable records looks like evidence.
      if (obsType === "exposure_outcome" && (!panelId || !outcome)) {
        return c.json(
          {
            resolved: false,
            success: false,
            shape: type,
            error:
              `an exposure_outcome needs panel_id and outcome (one of ${EXPOSURE_OUTCOMES.join(", ")}); ` +
              `panel_id ${panelId ? "was given" : "was missing"}, outcome ${
                outcome ? "was given" : `was ${JSON.stringify(pointer["outcome"] ?? null)}`
              }`,
          },
          400,
        );
      }
      // A form-decision record with no decisions on it is REFUSED, on the same
      // grounds as an outcome with no panel id: a corpus of unusable rows looks
      // like evidence, and a reader counting rows would over-report how much of
      // the surface has been observed.
      if (obsType === "form_decision") {
        const decisions = pointer["decisions"];
        if (!Array.isArray(decisions) || decisions.length === 0) {
          return c.json(
            {
              resolved: false,
              success: false,
              shape: type,
              error:
                "a form_decision needs a non-empty decisions[] — each entry naming shape, " +
                "content_signature, form and decided_by",
            },
            400,
          );
        }
      }
      const scanStatusRaw = optStr(pointer, "scan_status") ?? optStr(pointer, "scanStatus");
      const entry = recordObservation({
        type: obsType,
        panelId,
        askId: optStr(pointer, "ask_id") ?? optStr(pointer, "askId"),
        durationMs: optNum(pointer, "duration_ms") ?? optNum(pointer, "durationMs"),
        position: optPosition(pointer),
        visibility: asVisibility(pointer["visibility"], "operator_only"),
        ...(outcome ? { outcome } : {}),
        ...(pointer["outcome_scope"] === "ask" || pointer["outcomeScope"] === "ask"
          ? { outcomeScope: "ask" as const }
          : outcome
            ? { outcomeScope: "panel" as const }
            : {}),
        ...(() => {
          const n = optNum(pointer, "exposure_count") ?? optNum(pointer, "exposureCount");
          return n === undefined ? {} : { exposureCount: n };
        })(),
        ...(typeof pointer["inferred"] === "boolean" ? { inferred: pointer["inferred"] } : {}),
        ...(scanStatusRaw === "failed" || scanStatusRaw === "observed"
          ? { scanStatus: scanStatusRaw }
          : {}),
        ...(() => {
          const body = observationBody(pointer);
          return body ? { body } : {};
        })(),
      });

      // THE LEARNER'S TRIGGER. New outcome evidence exists exactly here, so the
      // pass runs here: an exported-but-uncalled learner reads correctly and
      // runs never. The result is REPORTED, not swallowed — a caller can see
      // whether a weight moved, and `reason` cites the evidence it moved on. A
      // refusal from the policy writer is the CONVERGED case (the weights the
      // evidence implies are already in force), not a failure, so it is
      // reported and not turned into a non-2xx on the record that was accepted.
      const learning =
        obsType === "exposure_outcome"
          ? (() => {
              const result = runImportanceLearningPass();
              return {
                changed: result.changed,
                changed_fields: result.changedFields,
                policy_revision: result.policy.revision,
                weights: result.policy.importanceWeights,
                moves: result.pass.moves,
                evidence: result.pass.evidence,
                skipped: result.pass.skipped,
                reason: result.pass.reason,
                ...(result.refusal ? { refusal: result.refusal.reason } : {}),
              };
            })()
          : undefined;

      return c.json({
        resolved: true,
        success: true,
        shape: type,
        body: entry,
        ...(learning ? { learning } : {}),
      });
    }

    case "interactorEvent": {
      const evtType = eventType(pointer);
      if (!evtType) {
        return c.json(
          {
            resolved: false,
            success: false,
            shape: type,
            error: `event_type required, one of ${EVENT_TYPES.join(", ")}`,
          },
          400,
        );
      }
      const entry = recordEvent({
        id: optStr(pointer, "id"),
        type: evtType,
        target: optStr(pointer, "target"),
        panelId: optStr(pointer, "panel_id") ?? optStr(pointer, "panelId"),
        body: optBody(pointer, "body"),
        visibility: asVisibility(pointer["visibility"], "public"),
      });
      return c.json({ resolved: true, success: true, shape: type, body: entry });
    }

    case "interactorAssertion": {
      const assertionBody = optStr(pointer, "body");
      if (!assertionBody || assertionBody.trim() === "") {
        return c.json(
          { resolved: false, success: false, shape: type, error: "body required" },
          400,
        );
      }
      const entry = recordAssertion({
        id: optStr(pointer, "id"),
        kind: str(pointer, "kind", "context"),
        body: assertionBody,
        visibility: asVisibility(pointer["visibility"], "operator_only"),
      });
      return c.json({ resolved: true, success: true, shape: type, body: entry });
    }

    case "interactorAttachment": {
      const ptr = optBody(pointer, "pointer");
      if (!ptr) {
        return c.json(
          { resolved: false, success: false, shape: type, error: "pointer object required" },
          400,
        );
      }
      const entry = recordAttachment({
        id: optStr(pointer, "id"),
        pointer: ptr,
        note: optStr(pointer, "note"),
        visibility: asVisibility(pointer["visibility"], "operator_only"),
      });
      return c.json({ resolved: true, success: true, shape: type, body: entry });
    }

    case "renderPolicy": {
      // A READ of the behaviour impulse. The surface fetches this every poll,
      // which is what makes the render decision a use-time lookup rather than a
      // build-time constant.
      return c.json({ resolved: true, success: true, shape: type, body: getRenderPolicy() });
    }

    case "renderPolicy_write": {
      // A WRITE. Anything that can author an impulse — the substrate, a human,
      // a future selection activity choosing between renderer arms — can change
      // how the surface renders, without a rebuild and without a deploy.
      const rawForms = optBody(pointer, "formByShape");
      const formByShape: Record<string, string> | undefined = rawForms
        ? Object.fromEntries(
            Object.entries(rawForms).filter(
              (e): e is [string, string] => typeof e[1] === "string",
            ),
          )
        : undefined;
      const maxPreview = pointer["maxPreviewChars"];
      const expanded = pointer["ledgerDefaultExpanded"];
      const rawTokens = optBody(pointer, "tokenOverrides");
      const tokenOverrides: Record<string, string> | undefined = rawTokens
        ? Object.fromEntries(
            Object.entries(rawTokens).filter(
              (e): e is [string, string] => typeof e[1] === "string",
            ),
          )
        : undefined;
      const rawPresentation = pointer["presentation"];
      const presentation =
        rawPresentation === "onepage" || rawPresentation === "stacked" ? rawPresentation : undefined;
      // Attribution. Accepted in both spellings because this vessel's own
      // callers write camelCase while substrate impulses are snake_cased, and a
      // caller whose key spelling is silently dropped is exactly the hollow
      // acceptance this route is being repaired for.
      const assignedBy = optStr(pointer, "assignedBy") ?? optStr(pointer, "assigned_by");
      const assignmentReason = optStr(pointer, "reason");
      // Everything this parser could not use, reported on BOTH outcomes below.
      const rejected: string[] = [];
      const importanceWeights = importanceWeightsPatch(pointer, rejected);
      const visibleSliceSize = visibleSliceSizePatch(pointer, rejected);
      const write = writeRenderPolicy({
        ...(tokenOverrides ? { tokenOverrides } : {}),
        ...(formByShape ? { formByShape } : {}),
        ...(presentation ? { presentation } : {}),
        ...(typeof maxPreview === "number" || maxPreview === null
          ? { maxPreviewChars: maxPreview as number | null }
          : {}),
        ...(typeof expanded === "boolean" ? { ledgerDefaultExpanded: expanded } : {}),
        ...(importanceWeights ? { importanceWeights } : {}),
        ...(visibleSliceSize !== undefined ? { visibleSliceSize } : {}),
        ...(typeof pointer["note"] === "string" ? { note: pointer["note"] as string } : {}),
        ...(assignedBy ? { assignedBy } : {}),
        ...(assignmentReason ? { reason: assignmentReason } : {}),
      });
      if (!write.changed) {
        // REFUSAL, not a 200 with a bumped revision. The caller is told what was
        // not read (`unread_keys`) as well as what this route does read, because
        // the whole defect being repaired here is a payload silently ignored: a
        // pointer that nests its fields under `policy` used to return 200 while
        // recording nothing, which is indistinguishable from success.
        const unread = Object.keys(pointer).filter(
          (k) =>
            k !== "type" &&
            k !== "assigned_by" &&
            k !== "importance_weights" &&
            k !== "visible_slice_size" &&
            !(RENDER_POLICY_PATCH_KEYS as readonly string[]).includes(k),
        );
        return c.json(
          {
            resolved: false,
            success: false,
            shape: type,
            applied: false,
            error: write.refusal?.reason ?? "this write moved no field",
            accepted_keys: write.refusal?.acceptedKeys ?? RENDER_POLICY_PATCH_KEYS,
            unread_keys: unread,
            // A value this route READ but could not use is not the same thing as
            // a key it never reads; collapsing the two would tell a learner its
            // weights were an unknown field when in fact one entry was junk.
            rejected_values: rejected,
            policy_revision: write.policy.revision,
            policy: write.policy,
          },
          422,
        );
      }
      return c.json({
        resolved: true,
        success: true,
        shape: type,
        body: write.policy,
        changed_fields: write.changedFields,
        // Reported on the SUCCESS path too: a partially-read weight table that
        // still moved a field is applied-but-partial, and that must not be
        // invisible under a green result (same rule the surfaceIntent branch
        // below applies to a partially parsed instruction).
        ...(rejected.length > 0 ? { rejected_values: rejected, partial: true } : {}),
      });
    }

    case "surfaceIntent": {
      // Prose in, interface change out. Deterministic parse FIRST: the LLM is
      // one resolver among many and never the controller, and "make the text
      // bigger" is a parse, not a reasoning problem.
      const text = optStr(pointer, "text") ?? optStr(pointer, "instruction") ?? optStr(pointer, "body");
      if (!text || text.trim() === "") {
        return c.json(
          {
            resolved: false,
            success: false,
            shape: type,
            error: "text required — the instruction to read",
            grammar: GRAMMAR,
          },
          400,
        );
      }
      const reading = readSurfaceIntent(text, getRenderPolicy());

      if (!reading.understood) {
        // NOT a no-op reported as success. Nothing moved, so nothing is
        // written, the revision does not advance, and the caller is told
        // exactly which words were not read and what this parser does read.
        recordSurfaceIntent({
          text,
          changedFields: [],
          unparsed: reading.unparsed.map((u) => u.text),
          appliedRevision: null,
        });
        return c.json(
          {
            resolved: false,
            success: false,
            shape: type,
            understood: false,
            applied: false,
            error: "no part of this instruction could be read",
            changes: [],
            unparsed: reading.unparsed,
            grammar: reading.grammar,
            policy_revision: getRenderPolicy().revision,
          },
          422,
        );
      }

      // Writes through the SAME shaped impulse every other author uses, so the
      // surface picks it up on its next read with no rebuild and no deploy.
      const write = writeRenderPolicy(reading.patch);
      if (!write.changed) {
        // The parser read the words and they asked for what is already in force.
        // Reported as understood-but-not-applied, on the same 422 as an unread
        // instruction: nothing happened, so nothing may read as applied.
        recordSurfaceIntent({
          text,
          changedFields: [],
          unparsed: reading.unparsed.map((u) => u.text),
          appliedRevision: null,
        });
        return c.json(
          {
            resolved: false,
            success: false,
            shape: type,
            understood: true,
            applied: false,
            error: write.refusal?.reason ?? "this instruction moved no field",
            changes: [],
            unparsed: reading.unparsed,
            policy_revision: write.policy.revision,
          },
          422,
        );
      }
      const next = write.policy;
      recordSurfaceIntent({
        text,
        changedFields: reading.changes.map((ch) => ch.field),
        unparsed: reading.unparsed.map((u) => u.text),
        appliedRevision: next.revision,
      });
      return c.json({
        resolved: true,
        success: true,
        shape: type,
        understood: true,
        applied: true,
        // A partial read is stated as partial. Some of what was asked for did
        // not happen, and that must not be invisible under a green result.
        partial: reading.unparsed.length > 0,
        changes: reading.changes,
        unparsed: reading.unparsed,
        ...(reading.unparsed.length > 0 ? { grammar: reading.grammar } : {}),
        body: next,
      });
    }

    default:
      // If this line stops compiling, DISCOVERY_SHAPES gained a shape with no
      // case above — the invariant, enforced by the typechecker.
      assertExhaustive(type);
      return c.json(
        {
          resolved: false,
          success: false,
          error: `unhandled shape '${String(type)}'`,
          supported_shapes: DISCOVERY_SHAPES,
        },
        400,
      );
  }
});

export default impulsesRouter;
