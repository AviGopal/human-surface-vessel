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
  getRenderPolicy,
  writeRenderPolicy,
  recordSurfaceIntent,
} from "../store.ts";
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

const OBSERVATION_TYPES = ["click", "dwell", "scroll", "focus"] as const;
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
      return c.json({
        resolved: true,
        success: true,
        shape: type,
        body: {
          questions,
          total: questions.length,
          unanswered: questions.filter((q) => !q.answered && !q.declined).length,
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
      let entry;
      try {
        entry = recordFeedback({
        id: optStr(pointer, "response_id"),
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
      const entry = recordObservation({
        type: obsType,
        panelId: optStr(pointer, "panel_id") ?? optStr(pointer, "panelId"),
        askId: optStr(pointer, "ask_id") ?? optStr(pointer, "askId"),
        durationMs: optNum(pointer, "duration_ms") ?? optNum(pointer, "durationMs"),
        position: optPosition(pointer),
        visibility: asVisibility(pointer["visibility"], "operator_only"),
      });
      return c.json({ resolved: true, success: true, shape: type, body: entry });
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
      const next = writeRenderPolicy({
        ...(tokenOverrides ? { tokenOverrides } : {}),
        ...(formByShape ? { formByShape } : {}),
        ...(presentation ? { presentation } : {}),
        ...(typeof maxPreview === "number" || maxPreview === null
          ? { maxPreviewChars: maxPreview as number | null }
          : {}),
        ...(typeof expanded === "boolean" ? { ledgerDefaultExpanded: expanded } : {}),
        ...(typeof pointer["note"] === "string" ? { note: pointer["note"] as string } : {}),
      });
      return c.json({ resolved: true, success: true, shape: type, body: next });
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
      const next = writeRenderPolicy(reading.patch);
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
