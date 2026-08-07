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
import { DISCOVERY_SHAPES, type DiscoveryShape } from "../config.js";
import {
  asVisibility,
  recordAssertion,
  recordAttachment,
  recordEvent,
  recordFeedback,
  recordObservation,
  upsertPanel,
  type Ask,
  type InteractorEvent,
  type Observation,
  getRenderPolicy,
  writeRenderPolicy,
} from "../store.js";

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
  return Array.isArray(v) ? (v as Ask[]) : undefined;
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
      const panel = upsertPanel({
        id: str(pointer, "id", `panel-${Date.now()}`),
        title: str(pointer, "title", "Untitled"),
        body: str(pointer, "body", ""),
        kind: str(pointer, "kind", type === "uiQuestion_write" ? "question" : "info"),
        importance: str(pointer, "importance", "medium"),
        asks: asks(pointer),
        visibility: asVisibility(pointer["visibility"], "public"),
      });
      return c.json({ resolved: true, success: true, shape: type, body: panel });
    }

    case "uiFeedback": {
      const panelId = optStr(pointer, "panel_id") ?? optStr(pointer, "panelId");
      if (!panelId) {
        return c.json(
          { resolved: false, success: false, shape: type, error: "panel_id required" },
          400,
        );
      }
      const entry = recordFeedback({
        panelId,
        askId: optStr(pointer, "ask_id") ?? optStr(pointer, "askId"),
        value: pointer["value"],
        kind: feedbackKind(pointer),
        visibility: asVisibility(pointer["visibility"], "public"),
      });
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
      const next = writeRenderPolicy({
        ...(tokenOverrides ? { tokenOverrides } : {}),
        ...(formByShape ? { formByShape } : {}),
        ...(typeof maxPreview === "number" || maxPreview === null
          ? { maxPreviewChars: maxPreview as number | null }
          : {}),
        ...(typeof expanded === "boolean" ? { ledgerDefaultExpanded: expanded } : {}),
        ...(typeof pointer["note"] === "string" ? { note: pointer["note"] as string } : {}),
      });
      return c.json({ resolved: true, success: true, shape: type, body: next });
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
