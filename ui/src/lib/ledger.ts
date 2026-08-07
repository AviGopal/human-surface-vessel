/**
 * The evidence ledger: what a walk actually put in the pool.
 *
 * Two rules are enforced here rather than in the components, because a rule
 * enforced in a component is a rule the next component forgets.
 *
 * 1. The empty-content case is a SEPARATE VARIANT, not a missing field.
 *    goal-host omits `contentPreview` and `truncated` entirely when an impulse
 *    carried nothing, so `entry.truncated === false` is never true for an empty
 *    impulse — it is `undefined`. Normalizing into a discriminated union makes
 *    the empty case impossible to render by accident as a blank content block.
 *
 * 2. Rendering dispatches on the FORM of the content, never on the shape name
 *    (rule P9). The registry advertises hundreds of shapes and the set is open
 *    and ragged — two live entries are entire prose sentences registered as
 *    shape names. Content, though, arrives in a small closed set of forms. The
 *    shape is a badge; the form drives the renderer; and the verbatim branch is
 *    the designed common case, not the error case.
 */

import { CONTENT_FORMS, DEFAULT_CONTENT_FORM, type ContentForm } from "@avigopal/design-tokens";
import type { RawProvenance } from "../api/types";

/** goal-host caps `contentPreview`; `chars` is the TRUE length. */
export const PREVIEW_CAP = 2000;

export type LedgerEntry =
  | {
      readonly kind: "content";
      readonly shape: string;
      readonly goalSignature: string | null;
      readonly producedBy: string | null;
      readonly preview: string;
      readonly chars: number;
      readonly truncated: boolean;
    }
  | {
      readonly kind: "empty";
      readonly shape: string;
      readonly goalSignature: string | null;
      readonly producedBy: string | null;
    };

function asString(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

/**
 * Turn one wire entry into something safe to render, or null if it is not an
 * entry at all.
 */
export function normalizeProvenance(raw: RawProvenance | unknown): LedgerEntry | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as RawProvenance;
  const shape = asString(r.shape);
  if (!shape) return null;

  const goalSignature = asString(r.goalSignature);
  const producedBy = asString(r.producedBy);
  const preview = asString(r.contentPreview);
  const chars = typeof r.chars === "number" && Number.isFinite(r.chars) ? r.chars : 0;

  // The empty branch: no preview key at all, or a preview that is only
  // whitespace. Both mean the same thing to a reader and both must be NAMED.
  if (preview === null || preview.trim().length === 0) {
    return { kind: "empty", shape, goalSignature, producedBy };
  }

  // `truncated` is absent on the empty branch and can be absent on older
  // records. Derive it rather than trusting the key to exist.
  const truncated = typeof r.truncated === "boolean" ? r.truncated : chars > PREVIEW_CAP;

  return {
    kind: "content",
    shape,
    goalSignature,
    producedBy,
    preview,
    chars: Math.max(chars, preview.length),
    truncated,
  };
}

export function normalizeLedger(raw: readonly unknown[] | undefined): readonly LedgerEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: LedgerEntry[] = [];
  for (const item of raw) {
    const entry = normalizeProvenance(item);
    if (entry) out.push(entry);
  }
  return out;
}

/* ─────────────────────────────── form detection ──────────────────────────── */

const DIFF_HEADER = /^(diff --git |index [0-9a-f]{7,}|@@ -\d+(,\d+)? \+\d+(,\d+)? @@|--- |\+\+\+ )/m;
const MARKDOWN_MARKER = /^(#{1,6} |[-*+] |\d+\. |> )/m;

/**
 * Shape-name HINTS. These bias the guess; they never decide it alone, and no
 * shape name is required to be known. An unrecognised shape falls through to
 * the same analysis as a recognised one.
 */
const PROSE_HINT = /(answer|note|lesson|concept|summary|report|reason|rationale|prose|memory|description)/i;
const ROWS_HINT = /(list|rows|table|records|entries|metrics)/i;
const DIFF_HINT = /(diff|patch|edit|codeChange)/i;

function looksLikeRows(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.every((r) => typeof r === "object" && r !== null && !Array.isArray(r));
      }
    } catch {
      // A truncated preview of a JSON array will not parse. That is expected —
      // it falls through to verbatim, which is the honest rendering of a
      // fragment.
      return false;
    }
    return false;
  }
  const lines = trimmed.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length < 2) return false;
  const tabbed = lines.filter((l) => l.includes("\t"));
  return tabbed.length >= 2 && tabbed.length === lines.length;
}

function looksLikeProse(text: string): boolean {
  const lines = text.trim().split("\n");
  if (MARKDOWN_MARKER.test(text)) return true;
  const words = text.trim().split(/\s+/).length;
  const avgLineLength = text.trim().length / Math.max(lines.length, 1);
  // Sentence punctuation plus long lines plus enough words to be a paragraph
  // rather than a log line.
  return words > 25 && avgLineLength > 45 && /[.!?]["')\]]?(\s|$)/.test(text);
}

/**
 * `override` is the shaped `renderPolicy` impulse, read at use time.
 *
 * When the policy names a form for this shape, it WINS. The heuristic below is
 * not deleted — it is demoted from a decision to a PRIOR, used only when the
 * policy is silent. That demotion is the whole law-1 fix: a render choice now
 * has a counterfactual, so it can be varied, graded, and replaced by a better
 * arm instead of being frozen into the bundle at build time.
 *
 * Empty content still short-circuits: an empty impulse is a fact about the
 * data, not a presentation preference, and no policy may dress it up as one.
 */
export function detectForm(
  shape: string,
  text: string,
  override?: Readonly<Record<string, string>>,
): ContentForm {
  if (text.trim().length === 0) return "empty";
  const pinned = override?.[shape];
  if (pinned && isKnownForm(pinned) && pinned !== "empty") return pinned;
  if (DIFF_HEADER.test(text)) return "diff";
  if (DIFF_HINT.test(shape) && /^[+-]/m.test(text)) return "diff";
  if (looksLikeRows(text)) return "rows";
  if (ROWS_HINT.test(shape) && looksLikeRows(text)) return "rows";
  if (looksLikeProse(text)) return "prose";
  if (PROSE_HINT.test(shape) && text.trim().split(/\s+/).length > 12) return "prose";
  // Everything else is verbatim monospace, and that is the DESIGNED common
  // case: most shapes will never earn a bespoke renderer and do not need one.
  return DEFAULT_CONTENT_FORM;
}

export function isKnownForm(form: string): form is ContentForm {
  return (CONTENT_FORMS as readonly string[]).includes(form);
}

/* ─────────────────────────── parsing helpers ─────────────────────────────── */

export interface ParsedRows {
  readonly columns: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

function cell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export function parseRows(text: string): ParsedRows | null {
  const trimmed = text.trim();
  if (trimmed.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (!Array.isArray(parsed) || parsed.length === 0) return null;
      const columns: string[] = [];
      for (const row of parsed) {
        if (typeof row !== "object" || row === null) return null;
        for (const key of Object.keys(row)) if (!columns.includes(key)) columns.push(key);
      }
      const rows = parsed.map((row) =>
        columns.map((c) => cell((row as Record<string, unknown>)[c])),
      );
      return { columns, rows };
    } catch {
      return null;
    }
  }
  const lines = trimmed.split("\n").filter((l) => l.trim().length > 0);
  const header = lines[0];
  if (!header) return null;
  const columns = header.split("\t").map((c) => c.trim());
  const rows = lines.slice(1).map((l) => {
    const parts = l.split("\t");
    return columns.map((_, i) => (parts[i] ?? "").trim());
  });
  return { columns, rows };
}

export type DiffLineKind = "added" | "removed" | "hunk" | "meta" | "context";

export interface DiffLine {
  readonly kind: DiffLineKind;
  readonly text: string;
}

export function parseDiff(text: string): readonly DiffLine[] {
  return text.split("\n").map((line): DiffLine => {
    if (line.startsWith("@@")) return { kind: "hunk", text: line };
    if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("diff --git") || line.startsWith("index "))
      return { kind: "meta", text: line };
    if (line.startsWith("+")) return { kind: "added", text: line };
    if (line.startsWith("-")) return { kind: "removed", text: line };
    return { kind: "context", text: line };
  });
}
