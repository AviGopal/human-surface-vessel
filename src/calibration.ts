/**
 * Blind calibration grading — which runs may be graded, and where a grade goes.
 *
 * A calibration window is a STANDING-POOL row of shape `calibrationWindow`,
 * written once by an operator (a trust-root pool write, admin key) and stamped
 * by development-vessel with `attested: { by: "operator", … }`. The row is the
 * only thing that makes a run gradable here: a missing, closed, unattested or
 * malformed window means calibration is UNAVAILABLE, never "every run eligible".
 *
 * Grades on sealed held-out runs are calibration-only: they measure the judge
 * and must not teach the system about the goal. So the row also says where a
 * grade may go (`label_sink`):
 *   - "report" (default): nothing is written to the system; the browser keeps
 *     the grades and exports them as a file.
 *   - "system": a `goal_verification_label_write` carrying
 *     `purpose:"calibration"`, which goal-host and every credit reader skip.
 */

export type CalibrationGrade = "reached" | "partial" | "not_reached";
export type LabelSink = "report" | "system";

export interface CalibrationWindow {
  readonly rowId: string;
  readonly windowId: string;
  readonly sampleDrawId: string;
  readonly seed: string | null;
  readonly dispatchIds: readonly string[];
  readonly declaredAt: number;
  readonly closesAt: number;
  readonly labelSink: LabelSink;
}

export type WindowParse = { ok: true; window: CalibrationWindow } | { ok: false; reason: string };

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

function time(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

/** One standing-pool row → a usable window, or the reason it is not one. */
export function parseWindow(row: unknown, now: number): WindowParse {
  if (!row || typeof row !== "object") return { ok: false, reason: "not a row" };
  const r = row as Record<string, unknown>;
  if (r["shape"] !== "calibrationWindow") return { ok: false, reason: "not a calibrationWindow" };
  if (r["status"] !== "open") return { ok: false, reason: "not open" };
  const attested = r["attested"] as { by?: unknown } | undefined;
  if (!attested || attested.by !== "operator") return { ok: false, reason: "unattested" };
  const b = (r["body"] && typeof r["body"] === "object" ? r["body"] : {}) as Record<string, unknown>;
  const windowId = str(b["window_id"]);
  const sampleDrawId = str(b["sample_draw_id"]);
  if (!windowId || !sampleDrawId) return { ok: false, reason: "missing window_id or sample_draw_id" };
  const declaredAt = time(b["declared_at"]);
  const closesAt = time(b["closes_at"]);
  if (declaredAt === null || closesAt === null) return { ok: false, reason: "missing declared_at or closes_at" };
  if (now < declaredAt) return { ok: false, reason: "not yet declared" };
  if (now >= closesAt) return { ok: false, reason: "closed" };
  const ids = Array.isArray(b["dispatch_ids"]) ? b["dispatch_ids"].map(str).filter((s): s is string => s !== null) : [];
  if (ids.length === 0) return { ok: false, reason: "no dispatch_ids" };
  const sink = b["label_sink"] === undefined ? "report" : b["label_sink"];
  if (sink !== "report" && sink !== "system") return { ok: false, reason: "unknown label_sink" };
  return {
    ok: true,
    window: {
      rowId: str(r["id"]) ?? windowId,
      windowId,
      sampleDrawId,
      seed: str(b["seed"]),
      dispatchIds: [...new Set(ids)],
      declaredAt,
      closesAt,
      labelSink: sink,
    },
  };
}

/** The corpus's verdict vocabulary (OracleVerdict). */
export function corpusVerdict(g: CalibrationGrade): "achieved" | "partial" | "not_achieved" {
  return g === "reached" ? "achieved" : g === "partial" ? "partial" : "not_achieved";
}

export function isGrade(v: unknown): v is CalibrationGrade {
  return v === "reached" || v === "partial" || v === "not_reached";
}

/**
 * Only this substrate's own pool may declare a window. A peer's row would be
 * attested by a peer's operator, whose authority here is nil; loopback is the
 * address of a vessel on this node.
 */
export function isOwnSubstrate(base: string): boolean {
  try {
    const h = new URL(base).hostname;
    return h === "127.0.0.1" || h === "localhost" || h === "::1" || h === "[::1]";
  } catch {
    return false;
  }
}
