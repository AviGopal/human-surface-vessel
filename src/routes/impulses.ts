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
import { DISCOVERY_ENDPOINT, DISCOVERY_SHAPES, METABOB_API_KEY, RESOLVE_PATH, type DiscoveryShape } from "../config.ts";
import {
  acceptedClassification,
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
  type Panel,
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
import { knownGapStatus, listedShapes, refreshGapStatuses } from "./proxy.ts";
import { classifyQuestion, gapIdForPanel, isUnfilledTemplate, type QuestionClass } from "../question-class.ts";
import { FORM_LEARNER_ID, runFormLearningPass } from "../form-learn.ts";
import { GRAMMAR, readSurfaceIntent } from "../surface-intent.ts";
import { buildUiView } from "../ui-view.ts";
import { recheckPatch } from "../recheck.ts";
import { LIMITS } from "../limits.ts";
import { TIMEOUTS } from "../timeouts.ts";
import { runOf, undoView, writeView } from "../ui-views.ts";
import { countEmptyRefusal, countTemplateRefusal } from "../write-refusals.ts";
import { admitCaller, type Caller } from "../inbound-auth.ts";

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
const PANEL_CONTENT_KEYS = ["title", "body", "kind", "importance", "asks", "visibility", "reader"] as const;
/** The fields that name a panel or question; a template placeholder in one is refused. */
const PLACEHOLDER_FIELDS = ["id", "kind", "title", "importance"] as const;

/** Why a questions read served none, in the person's words. */
function emptyReason(open: boolean, discoveryAnswered: boolean, classes: Record<QuestionClass, number>): string {
  if (!discoveryAnswered) return "None confirmed: discovery did not answer, so no question's reader could be checked.";
  if (!open) return "No questions.";
  const n = classes.unread;
  if (n === 0) return "Nothing waits on you.";
  return `None. ${n} open question${n === 1 ? "" : "s"} name${n === 1 ? "s" : ""} no reader this node serves.`;
}

/** The declared reader: a shape name, or undefined when the pointer names none or names it badly. */
function readerOf(pointer: Record<string, unknown>): string | undefined {
  const v = pointer["reader"];
  return typeof v === "string" && /^[A-Za-z0-9_:.-]{1,120}$/.test(v) ? v : undefined;
}

function hasQuestionContent(pointer: Record<string, unknown>): boolean {
  const filled = (v: unknown): boolean =>
    typeof v === "string" ? v.trim() !== "" : v !== null && v !== undefined && !(typeof v === "object" && Object.keys(v as object).length === 0);
  const asksList = pointer["asks"];
  return filled(pointer["title"]) || filled(pointer["body"]) || (Array.isArray(asksList) && asksList.length > 0);
}

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
  /** A person's choice of a different form for one payload: read by the form learner. */
  "form_choice",
  /** A verdict on a run from any source, kept as an observation (body: dispatch_id, verdict, source, …). */
  "verdict",
  /** The box refused a reading about the output on screen (body: text, reason, shape, region, origin). */
  "surface_intent_refused",
  /** What upstream answered when a verdict was forwarded (body: dispatch_id, verdict_at, status, recorded, reason). */
  "verdict_delivery",
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

/**
 * The panel's provenance stamp (store.ts `Panel.origin`), from the caller this route
 * ADMITTED (inbound-auth.ts), never from the pointer's own claim: a panel write is
 * keyed-only, so `origin` is the key's class and `producer` its validated label.
 * The creator's stamp is kept on update, and a panel created before stamps existed
 * stays unstamped (its creator is unknown, and a later writer is not its creator),
 * so the legacy rule in importance-learn.ts `testOriginPanels` still judges it.
 */
function panelStamp(existing: Panel | undefined, caller: Caller | null): { origin?: string; producer?: string } {
  if (existing) {
    return { ...(existing.origin ? { origin: existing.origin } : {}), ...(existing.producer ? { producer: existing.producer } : {}) };
  }
  return caller ? { origin: caller.origin, producer: caller.label } : {};
}

/** What a stored feedback or observation record keeps of the caller that wrote it. */
function callerStamp(caller: Caller | null): { caller?: { origin: string; label: string } } {
  return caller ? { caller: { origin: caller.origin, label: caller.label } } : {};
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

export const impulsesRouter = new Hono();

/** The shapes this route answers without a caller: they read, and write nothing. */
const IMPULSE_READ_TYPES: ReadonlySet<string> = new Set(["uiQuestion", "renderPolicy", "human_surface:ui_view"]);

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

  // EVERY WRITE NAMES ITS CALLER (inbound-auth.ts). Only the reads below pass without one.
  // No keyless browser entry exists for this route: a browser write reaches it only from
  // the browser routes that admitted it (participation, feedback, observations).
  let caller: Caller | null = null;
  if (!IMPULSE_READ_TYPES.has(type)) {
    const gate = await admitCaller(c, RESOLVE_PATH, type);
    if (gate.refused) return gate.refused;
    caller = gate.caller;
  }

  switch (type) {
    case "uiPanel_write":
    case "uiQuestion_write": {
      // (0) REFUSE an unfilled template. A naming field still reading "{{goal.id}}" is a
      // writer whose bindings never resolved: stored, it is a question titled with a
      // placeholder, ranked like any other, and every later write with the same unfilled
      // id lands on that one row. The body is the writer's content and may quote one.
      const unfilled = PLACEHOLDER_FIELDS.find((k) => typeof pointer[k] === "string" && isUnfilledTemplate(pointer[k] as string));
      if (unfilled) {
        countTemplateRefusal(type);
        return c.json({
          resolved: false,
          success: false,
          shape: type,
          error: `unfilled template refused: ${unfilled} is ${JSON.stringify(pointer[unfilled])}, a placeholder its writer never filled. Nothing was written. Fill the template's bindings before writing.`,
        }, 422);
      }
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

      // (3) A new panel or question must carry something. A blank question is a
      // demand on a person's attention with nothing in it, and an asker reads a 200
      // as "asked". A blank panel is the same hollow write: no flow creates a panel
      // empty and fills it later (every writer sends its content in the first write),
      // so an empty one is only ever a defaulted step's side effect, and it was kept
      // as an "Untitled" panel nobody reads. Refusing makes the writer fail.
      if (!existing && !hasQuestionContent(pointer)) {
        countEmptyRefusal(type);
        return c.json({
          resolved: false,
          success: false,
          shape: type,
          error: `empty ${type === "uiQuestion_write" ? "question" : "panel"} refused: a new ${type} needs a non-empty title, body or asks. Nothing was created.`,
        }, 422);
      }

      // (1) ABSENCE PRESERVES. `Object.hasOwn` is the only form that tells
      // "field omitted" apart from "field explicitly empty": an explicit
      // `body: ""` must still clear the body, while an omitted body on an
      // existing panel must keep what is stored. `??` collapses the two.
      // Literal defaults apply ONLY when there is no existing panel.
      const reader = Object.hasOwn(pointer, "reader") ? readerOf(pointer) : existing?.reader;
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
        ...(reader ? { reader } : {}),
        // The writer's stamp, as the exposure reporter's is kept on observations:
        // what the learner reads to tell a live panel from a test's.
        ...panelStamp(existing, caller),
      });
      return c.json({ resolved: true, success: true, shape: type, body: panel });
    }

    case "human_input": {
      // A step asking its human. Stored as an ordinary question — journaled, ranked,
      // answerable like any other — carrying what the asker named it by. The surface no
      // longer reads a dispatch host's run to link the question to it: that host is gone,
      // and a question is answered on the question.
      const solicitationId = optStr(pointer, "solicitation_id") ?? optStr(pointer, "solicitationId");
      if (!solicitationId) {
        return c.json({ resolved: false, success: false, shape: type, error: "solicitation_id is required" }, 400);
      }
      const dispatchId = optStr(pointer, "dispatch_id") ?? optStr(pointer, "dispatchId") ?? null;
      // An unfilled template names the stored question ("solicitation-{{goal.id}}"), so it is
      // refused as the panel door refuses one. The brief, and the title read off it, are content.
      const unfilled = ([["solicitation_id", solicitationId], ["dispatch_id", dispatchId]] as const).find(([, v]) => v !== null && isUnfilledTemplate(v));
      if (unfilled) {
        countTemplateRefusal(type);
        return c.json({
          resolved: false,
          success: false,
          shape: type,
          error: `unfilled template refused: ${unfilled[0]} is ${JSON.stringify(unfilled[1])}, a placeholder its writer never filled. Nothing was written. Fill the template's bindings before writing.`,
        }, 422);
      }
      // The brief is what the asker wrote (a shaped brief, or markdown).
      const brief = Object.hasOwn(pointer, "brief") ? pointer["brief"] : (pointer["question_markdown"] ?? "");
      const deadlineAt =
        optNum(pointer, "deadline_at") ??
        (optNum(pointer, "timeout_ms") !== undefined ? Date.now() + (optNum(pointer, "timeout_ms") as number) : null);
      const linked = false;
      const firstLine = typeof brief === "string" ? (brief.split("\n").find((l) => l.trim()) ?? "").replace(/^#+\s*/, "").trim() : "";
      const panel = upsertPanel({
        id: `solicitation-${solicitationId}`,
        title: firstLine.slice(0, 160) || "Question",
        body: brief,
        kind: "question",
        importance: "high",
        run: { dispatchId, solicitationId, deadlineAt, linked },
        ...(readerOf(pointer) ? { reader: readerOf(pointer) } : {}),
        ...panelStamp(getPanel(`solicitation-${solicitationId}`), caller),
      });
      return c.json({ resolved: true, success: true, shape: type, body: { panelId: panel.id, linked } });
    }

    case "uiQuestion": {
      const wanted = optStr(pointer, "id") ?? optStr(pointer, "panel_id");
      const listed = await listedShapes();
      const matched = listPanels()
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
        .map(questionView)
        // A declared reader counts only while discovery lists it; unknown is not listed.
        .map((view) => ({ ...view, readerListed: view.reader !== undefined && listed !== null && listed.has(view.reader) }))
        // The status of the gap each one asks about, as last read. Unknown stays
        // unknown: only a status the gap store gave can fold a question as settled.
        .map((view) => {
          const gapId = gapIdForPanel(view.id);
          const status = gapId ? knownGapStatus(gapId) : null;
          return status ? { ...view, gapStatus: status } : view;
        });
      // How the open questions classify, over the whole matched set and not the slice, so a
      // folded line's count is the state and not what fitted in a payload. One pass over the
      // stored questions, in memory, with no read of its own.
      const classes: Record<QuestionClass, number> = { ask: 0, notice: 0, settled: 0, unread: 0, malformed: 0 };
      for (const q of matched) if (!q.answered && !q.declined) classes[classifyQuestion(q)] += 1;
      const questions = matched
        // `open: true`: only what waits on a person (an ask not answered or set aside).
        .filter((q) => pointer["open"] !== true || (!q.answered && !q.declined && classifyQuestion(q) === "ask"));
      // Refreshed off the request path: this read never waits on the gap store.
      void refreshGapStatuses(matched.flatMap((q) => gapIdForPanel(q.id) ?? [])).catch(() => {});

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

      // ASKS FIRST, then the rest in their own importance order. The slice was cut
      // before the rail folded the rows nobody can act on, so on one node 30 of 50
      // slots went to rows the browser then hid (no reader, notices, malformed,
      // since: gap closed) while 93 rows were not served at all.
      const scored = rankPanels(questions, policy.importanceWeights, Date.now());
      const asks = new Set(questions.filter((q) => classifyQuestion(q) === "ask").map((q) => q.id));
      const ranked = [...scored.filter((x) => asks.has(x.panel.id)), ...scored.filter((x) => !asks.has(x.panel.id))];
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
          classes,
          // Why open questions are not offered as waiting. `unlisted` is the open questions that
          // ask something (not a notice, which asks nothing; not malformed; not about a closed gap)
          // and name no reader discovery lists: `classes.unread`. When discovery did not answer,
          // no reader could be confirmed.
          readers: {
            discovery: listed === null ? "unreachable" : "answered",
            unlisted: classes.unread,
          },
          // What an empty read means, said by the read, so the page does not guess it.
          ...(questions.length === 0 ? { empty_reason: emptyReason(pointer["open"] === true, listed !== null, classes) } : {}),
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
      // A complaint about the interface is the person's own row (`world_changed`, under their
      // key), not a gap this surface files under its own. Refused by name rather than ignored.
      if (pointer["complaint_kind"] !== undefined) {
        return c.json(
          {
            resolved: false,
            success: false,
            shape: type,
            error: "complaint_kind is not read: a complaint is a world_changed row written under the person's own key",
          },
          422,
        );
      }
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
        ...callerStamp(caller),
        ...(() => {
          const kept = acceptedClassification(optStr(pointer, "classified_by"), optStr(pointer, "classified_phrase"));
          return kept ? { classifiedBy: kept } : {};
        })(),
      });
      } catch (error) {
        if (error instanceof ParticipationConflict) {
          return c.json({ resolved: false, success: false, error: error.message }, 409);
        }
        throw error;
      }
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
      // A form choice names the payload's shape and both forms, or it is not evidence.
      if (obsType === "form_choice") {
        const shapeOf = optStr(pointer, "shape");
        const from = optStr(pointer, "form_from");
        const to = optStr(pointer, "form_to");
        if (!shapeOf || !from || !to || from === to) {
          return c.json(
            {
              resolved: false,
              success: false,
              shape: type,
              error: "a form_choice needs shape, form_from and form_to (different forms)",
            },
            400,
          );
        }
      }
      const scanStatusRaw = optStr(pointer, "scan_status") ?? optStr(pointer, "scanStatus");
      const entry = recordObservation({
        type: obsType,
        ...callerStamp(caller),
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
      // A person's form choice is new evidence for the form learner only.
      if (obsType === "form_choice") {
        const formPass = runFormLearningPass();
        const formWrite = formPass.changed
          ? writeRenderPolicy({ learnedFormByShape: formPass.learnedFormByShape, assignedBy: FORM_LEARNER_ID, reason: formPass.reason })
          : null;
        return c.json({
          resolved: true,
          success: true,
          shape: type,
          body: entry,
          learning: {
            form_learning: {
              changed: formPass.changed,
              learned_form_by_shape: formWrite ? formWrite.policy.learnedFormByShape : formPass.learnedFormByShape,
              moves: formPass.moves,
              reason: formPass.reason,
              learner: formPass.learnerId,
              ...(formWrite?.refusal ? { refusal: formWrite.refusal.reason } : {}),
            },
          },
        });
      }

      const learning =
        obsType === "exposure_outcome"
          ? (() => {
              const result = runImportanceLearningPass();
              // THE FORM LEARNER runs at the same trigger — new outcome evidence
              // is new evidence for both. It returns the table it wants written
              // and never writes itself; the write happens here, carrying ONLY
              // learnedFormByShape so the human's formByShape is never touched.
              // KNOWN DOUBLE-BUMP: when both passes move on one outcome the
              // revision advances twice. Folding the two into one write means
              // changing the importance pass's contract; deferred, and named.
              const formPass = runFormLearningPass();
              const formWrite = formPass.changed
                ? writeRenderPolicy({ learnedFormByShape: formPass.learnedFormByShape, assignedBy: FORM_LEARNER_ID, reason: formPass.reason })
                : null;
              return {
                changed: result.changed,
                changed_fields: result.changedFields,
                policy_revision: formWrite ? formWrite.policy.revision : result.policy.revision,
                weights: result.policy.importanceWeights,
                moves: result.pass.moves,
                evidence: result.pass.evidence,
                skipped: result.pass.skipped,
                reason: result.pass.reason,
                ...(result.refusal ? { refusal: result.refusal.reason } : {}),
                form_learning: {
                  changed: formPass.changed,
                  learned_form_by_shape: formWrite ? formWrite.policy.learnedFormByShape : formPass.learnedFormByShape,
                  moves: formPass.moves,
                  evidence: formPass.evidence,
                  skipped: formPass.skipped,
                  reason: formPass.reason,
                  learner: formPass.learnerId,
                  ...(formWrite?.refusal ? { refusal: formWrite.refusal.reason } : {}),
                },
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

    case "uiView_write": {
      // A WRITE, by anything that can author an impulse: what a region draws, in what order.
      // Checked against the closed vocabulary; a refusal names its reason and
      // stores nothing. `undo: true` restores the view in force before the current one.
      const region = pointer["region"];
      const run = runOf(pointer);
      const write = pointer["undo"] === true
        ? undoView(region, caller?.label ?? null, Date.now(), run)
        : writeView({ region, entries: pointer["entries"], blocks: pointer["blocks"], limits: pointer["limits"], reports: pointer["reports"], note: pointer["note"] }, caller?.label ?? null, Date.now(), run);
      if (!write.ok) {
        return c.json({ resolved: false, success: false, shape: type, refusal: write.refusal, error: `${write.refusal}: ${write.detail}` }, 422);
      }
      // `unchanged`: the view asked for was already in force; nothing was written and the revision stands.
      return c.json({ resolved: true, success: true, shape: type, body: { region: write.view.region, revision: write.view.revision, view: write.view, ...(write.unchanged ? { unchanged: true } : {}) } });
    }

    case "human_surface:ui_view": {
      // What this surface looks like to a person, measured where it can be:
      // typography, the forms content was drawn in, and the questions rail
      // (how each kind is presented, who reads its answers, what people did).
      // A question writer reads this by shape before it asks.
      return c.json({ resolved: true, success: true, shape: type, body: buildUiView(getRenderPolicy().tokenOverrides, await listedShapes()) });
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
      const recheck = recheckPatch(pointer["recheck"], rejected);
      const limits = LIMITS.patch(pointer["limits"], rejected);
      const timeouts = TIMEOUTS.patch(pointer["timeouts"], rejected);
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
        ...(recheck ? { recheck } : {}),
        ...(limits ? { limits } : {}),
        ...(timeouts ? { timeouts } : {}),
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
