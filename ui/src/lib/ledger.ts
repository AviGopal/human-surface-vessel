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
 *
 * 3. The ENVELOPE PRE-PASS decides WHICH content is drawn, and it is therefore
 *    a transform here rather than a form. Making it a form would let a human
 *    pin `shellResult` to "envelope" and get a permanent double-render, and it
 *    would collide with the payload's own form; it has no renderer of its own,
 *    because its output is always some other form. Measured: three of three
 *    pool entries on each reached run arrived as a JSON OBJECT — most of them
 *    `{shape, stdout, stderr, exit_code}` — whose 33-line stdout rendered as
 *    one logical line of literal two-character `\n` sequences. The object is
 *    the single most common content form the pool produces and it had no
 *    branch anywhere.
 */

import {
  CONTENT_FORMS,
  DEFAULT_CONTENT_FORM,
  NON_PINNABLE_FORMS,
  type ContentForm,
} from "@avigopal/design-tokens";
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
  const trimmed = text.trim();
  // Defence in depth for the guard in `heuristicForm`. A 2,000-character
  // single-line JSON blob trivially satisfies every test below — enough words,
  // one very long line, a full stop somewhere inside a string — and four live
  // previews (codeReadResult 51,689 chars, memoryNote 85,595, shellResult
  // 2,293 carrying a real `diff --git` hunk, substrateGap 93,214) were being
  // markdown-REFLOWED because of it, which destroys every column and every
  // line break in them. Structured data is never prose, whatever it scores.
  // The guard is repeated here so a future caller cannot route around it.
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return false;
  const lines = trimmed.split("\n");
  if (MARKDOWN_MARKER.test(text)) return true;
  const words = text.trim().split(/\s+/).length;
  const avgLineLength = text.trim().length / Math.max(lines.length, 1);
  // Sentence punctuation plus long lines plus enough words to be a paragraph
  // rather than a log line.
  return words > 25 && avgLineLength > 45 && /[.!?]["')\]]?(\s|$)/.test(text);
}

/**
 * The guess, and only ever the guess. It is applied to a raw preview and to an
 * unwrapped envelope payload alike; `fromEnvelope` is the difference, and it is
 * the only positive evidence this function has that the text it is holding came
 * out of a command rather than off the wire.
 *
 * That flag is why `terminal` has no free-standing test. "This looks like
 * terminal output" is exactly the sort of guess the ContentRender header
 * forbids — a wall of prose with two line breaks would satisfy any such test —
 * so terminal is reachable only from a payload we PARSED out of a `stdout`
 * field, or from a human's explicit pin.
 */
export function heuristicForm(shape: string, text: string, fromEnvelope: boolean): ContentForm {
  if (DIFF_HEADER.test(text)) return "diff";
  if (DIFF_HINT.test(shape) && /^[+-]/m.test(text)) return "diff";

  // THE ONE-UNWRAP RULE, enforced rather than merely documented.
  //
  // `planContent` promises the payload is never re-parsed as JSON, but
  // `looksLikeRows` below calls JSON.parse — so on an envelope payload that
  // promise was false, and a command that printed a JSON array had its output
  // re-read as this surface's own table. That misreading is not cosmetic: the
  // table renders the PARSED value, so any line of stdout outside the array is
  // silently deleted from what the reader sees.
  //
  // A payload came out of a command. Structured text a command printed is
  // output to be shown, not structure to be adopted.
  const fromCommand = fromEnvelope && /^\s*[[{]/.test(text);
  if (fromCommand) return DEFAULT_CONTENT_FORM;

  if (looksLikeRows(text)) return "rows";
  if (ROWS_HINT.test(shape) && looksLikeRows(text)) return "rows";

  // THE GUARD, and it sits BEFORE both prose tests on purpose. Structured data
  // can never be prose regardless of word count, line length or sentence
  // punctuation; markdown-reflowing a JSON blob collapses its escaped newlines
  // into spaces and destroys the only structure it had. Falling to `text` here
  // is what makes refusing truncated-prefix recovery safe: the nine previews
  // that were being reflowed become honest mono verbatim under the footer that
  // already says how much of them is showing.
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return DEFAULT_CONTENT_FORM;

  if (looksLikeProse(text)) return "prose";
  if (PROSE_HINT.test(shape) && trimmed.split(/\s+/).length > 12) return "prose";

  if (fromEnvelope) {
    const lines = text.split("\n").filter((l) => l.trim().length > 0);
    if (lines.length >= 2) return "terminal";
    if (lines.length === 1 && trimmed.length <= SCALAR_MAX_CHARS) return "scalar";
  }

  // Everything else is verbatim monospace, and that is the DESIGNED common
  // case: most shapes will never earn a bespoke renderer and do not need one.
  return DEFAULT_CONTENT_FORM;
}

/**
 * One line of context from an envelope, drawn as a chip rather than as JSON.
 *
 * A closed union, and deliberately short: every OTHER residual key on an
 * envelope (`path` and `total_lines` on codeReadResult, and whatever the next
 * producer invents) is DROPPED rather than guessed at, and stays reachable
 * through the footer's "the full content is in the trace". A chip line that
 * grows a row per unrecognised key is the raw-JSON problem again with borders.
 */
export type MetaChip =
  | { readonly kind: "exit"; readonly code: number }
  | { readonly kind: "stderr"; readonly text: string }
  | { readonly kind: "envelopeShape"; readonly shape: string };

export interface RenderPlan {
  readonly form: ContentForm;
  /** What to draw. NOT always the preview: an unwrapped envelope draws its payload. */
  readonly text: string;
  /** The key a single-key wrapper was carrying its value under. */
  readonly label?: string;
  readonly meta?: readonly MetaChip[];
  /** The `shape` field INSIDE the envelope, when it declared one. */
  readonly envelopeShape?: string;
}

/** Above this a value is not a scalar, whatever it parsed out of. */
const SCALAR_MAX_CHARS = 300;

/**
 * Every key a command envelope is allowed to carry.
 *
 * Deliberately a CLOSED list, and deliberately checked as "all keys are in
 * here" rather than "some key is in here". Unwrapping throws away every field
 * that is not the payload, so the test that permits it has to be a test for the
 * WHOLE object, not for one field of it. Anything carrying an unrecognised key
 * is not a command envelope this renderer understands, and falls to `record`,
 * which shows all of its fields.
 *
 * Adding a key here is a decision to let that field be discarded. Do not add
 * one because a shape happened to appear with it.
 */
const COMMAND_ENVELOPE_KEYS: ReadonlySet<string> = new Set([
  "shape",
  "stdout",
  "stderr",
  "exit_code",
  "exitCode",
  "command",
  "cwd",
  "duration_ms",
  "durationMs",
  "truncated",
  "success",
]);

function isCommandEnvelope(keys: readonly string[]): boolean {
  return keys.every((k) => COMMAND_ENVELOPE_KEYS.has(k));
}

function isPinnable(form: ContentForm): boolean {
  return !(NON_PINNABLE_FORMS as readonly ContentForm[]).includes(form);
}

function envelopeMeta(
  o: Readonly<Record<string, unknown>>,
  shape: string,
  payload: string,
): readonly MetaChip[] {
  const chips: MetaChip[] = [];
  const code = o["exit_code"];
  if (typeof code === "number" && Number.isFinite(code)) chips.push({ kind: "exit", code });
  const stderr = o["stderr"];
  // Only when stderr is not ITSELF what we are drawing — otherwise the same
  // bytes appear twice, once as the output and once as a footnote about it.
  if (typeof stderr === "string" && stderr.trim().length > 0 && stderr !== payload) {
    chips.push({ kind: "stderr", text: stderr });
  }
  const declared = o["shape"];
  // Shown only when it disagrees with the badge above the card. Repeating the
  // badge is noise; contradicting it is information.
  if (typeof declared === "string" && declared !== shape) {
    chips.push({ kind: "envelopeShape", shape: declared });
  }
  return chips;
}

/**
 * What to draw, and what to draw it as. The single decision point.
 *
 * `override` is the shaped `renderPolicy` impulse, read at use time. When the
 * policy names a form for this shape, it WINS — over the unwrap as well as over
 * the guess. The heuristic is not deleted; it is demoted from a decision to a
 * PRIOR, used only when the policy is silent. That demotion is the whole law-1
 * fix: a render choice now has a counterfactual, so it can be varied, graded,
 * and replaced by a better arm instead of being frozen into the bundle at build
 * time — and a human who pins `shellResult` to `text` must get the raw JSON
 * back, which is only true if the pin runs before the unwrap.
 *
 * The order below is load-bearing at every step:
 *
 *   S0  empty short-circuits and is never overridable — an empty impulse is a
 *       fact about the data, not a presentation preference.
 *   S1  the pin, whole-pipeline: no unwrap, no parse.
 *   S2  TRUNCATED CONTENT SKIPS THE JSON ANALYSIS ENTIRELY. No prefix recovery,
 *       no partial parse. A fragment that half-parses is exactly how a renderer
 *       comes to present a guess as a reading.
 *   S3–S5 anything that does not fully parse to a plain object goes back to the
 *       guess; JSON arrays are already handled by `looksLikeRows`.
 *   S6  classify the object, first match wins.
 *   S7  the guess, on the raw preview or on the unwrapped payload.
 */
export function planContent(
  shape: string,
  preview: string,
  truncated: boolean,
  formByShape?: Readonly<Record<string, string>>,
): RenderPlan {
  if (preview.trim().length === 0) return { form: "empty", text: "" };

  const pinned = formByShape?.[shape];
  if (pinned !== undefined && isKnownForm(pinned) && isPinnable(pinned)) {
    return { form: pinned, text: preview };
  }

  if (truncated) return { form: heuristicForm(shape, preview, false), text: preview };

  let parsed: unknown;
  try {
    parsed = JSON.parse(preview.trim());
  } catch {
    return { form: heuristicForm(shape, preview, false), text: preview };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { form: heuristicForm(shape, preview, false), text: preview };
  }

  const o = parsed as Record<string, unknown>;
  const keys = Object.keys(o);

  // (a) the producer stub. An exact key set, because anything looser would
  // claim "no content carried" over a record that carried some.
  if (keys.length === 2 && typeof o["producedBy"] === "string" && typeof o["executionId"] === "string") {
    return { form: "stub", text: preview };
  }

  // (b) the command envelope. EXACTLY ONE unwrap — the payload is never
  // re-parsed as JSON, because a second pass is how a shell that printed a
  // JSON document ends up rendered as this surface's own structure.
  //
  // The membership test is what makes the unwrap SAFE. Testing only "has a
  // string stdout or stderr key" is not a test for a command envelope, it is a
  // test for one field an envelope happens to have: an object like
  // `{"written":true,"path":"/tmp/x","stderr":""}` passed it, and unwrapping
  // discarded `written` and `path` and then rendered the result as a positive
  // claim that the impulse carried nothing. Requiring every key to be a known
  // envelope key means an object with anything unrecognised on it falls to
  // `record` instead, where all of its fields are shown. Losing a field is
  // worse than declining to unwrap.
  const stdout = typeof o["stdout"] === "string" ? o["stdout"] : null;
  const stderr = typeof o["stderr"] === "string" ? o["stderr"] : null;
  if ((stdout !== null || stderr !== null) && isCommandEnvelope(keys)) {
    const payload = stdout !== null && stdout.length > 0 ? stdout : (stderr ?? "");
    const meta = envelopeMeta(o, shape, payload);
    const declared = typeof o["shape"] === "string" ? { envelopeShape: o["shape"] } : {};
    // The command ran and printed nothing. NAME that — it is a different fact
    // from "this impulse was empty", and both are different from a blank box.
    if (payload.trim().length === 0) return { form: "empty", text: "", meta, ...declared };
    return { form: heuristicForm(shape, payload, true), text: payload, meta, ...declared };
  }

  // (c) the single-key wrapper: `{"goal":"…"}`, `{"error":"…"}`. The key is a
  // label, not a column heading, and the value is the content.
  const only = keys.length === 1 ? keys[0] : undefined;
  if (only !== undefined) {
    const value = o[only];
    if (
      typeof value === "string" &&
      !value.includes("\n") &&
      value.trim().length <= SCALAR_MAX_CHARS
    ) {
      return { form: "scalar", text: value, label: only };
    }
  }

  // (d) every other object, recognised or not. This is where result envelopes,
  // write receipts and each shape nobody has seen yet land.
  return { form: "record", text: preview };
}

/**
 * The form alone, for a caller that has no plan to thread. Kept as the narrow
 * public API of this module: a form is derivable from a plan, never the other
 * way round.
 */
export function detectForm(
  shape: string,
  text: string,
  override?: Readonly<Record<string, string>>,
): ContentForm {
  return planContent(shape, text, false, override).form;
}

export function isKnownForm(form: string): form is ContentForm {
  return (CONTENT_FORMS as readonly string[]).includes(form);
}

/* ─────────────────────────── parsing helpers ─────────────────────────────── */

/**
 * One table cell. `summarised` is the honest half of the contract: a cell that
 * stands in for a value the table cannot hold must SAY it is standing in, or a
 * reader takes the stand-in for the value.
 */
export interface Cell {
  readonly text: string;
  /** The elided value, for the `title` attribute. Capped — a tooltip is not a viewer. */
  readonly title?: string;
  readonly summarised?: boolean;
}

export interface ParsedRows {
  readonly columns: readonly string[];
  readonly rows: readonly (readonly Cell[])[];
}

/** A tooltip is a hint, not a second content pane. */
const CELL_TITLE_CAP = 2000;

/**
 * A value, made fit for one table cell.
 *
 * Nested values used to be `JSON.stringify`'d straight into the cell, which put
 * an unreadable one-line document inside a column sized for a word and blew the
 * table's alignment apart — the alignment being the only reason the table form
 * exists. There is deliberately NO recursion here: a table inside a cell
 * destroys the same alignment from the other direction. A count plus a
 * `title`, visibly marked as a summary, is the honest thing a cell can hold.
 */
function cell(v: unknown): Cell {
  if (v === null || v === undefined) return { text: "" };
  // A multiline string cannot blow up the row height either. The pilcrow keeps
  // the break visible instead of silently joining two lines into one claim.
  if (typeof v === "string") return { text: v.replace(/\n/g, " ⏎ ") };
  if (typeof v === "number" || typeof v === "boolean") return { text: String(v) };
  let title: string;
  try {
    title = JSON.stringify(v).slice(0, CELL_TITLE_CAP);
  } catch {
    title = String(v);
  }
  if (Array.isArray(v)) {
    return { text: `[${v.length} items]`, title, summarised: true };
  }
  return { text: `{${Object.keys(v as object).length} fields}`, title, summarised: true };
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
    return columns.map((_, i): Cell => ({ text: (parts[i] ?? "").trim() }));
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
