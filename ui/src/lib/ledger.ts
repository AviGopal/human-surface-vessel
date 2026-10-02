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

  // PROVENANCE BEATS THE GUESS, and this is why it sits ABOVE the prose tests.
  //
  // `fromEnvelope` is not a heuristic — it is the fact that these bytes came out
  // of a command, carried by the envelope they were unwrapped from. Everything
  // below is inference from punctuation and line length. `looksLikeProse` used
  // to run first and it won on real command output: `systemctl list-units`
  // prints a DESCRIPTION column full of sentences, so the whole listing was
  // classified as prose and reflowed, which is precisely the column-destroying
  // render the terminal form exists to prevent.
  //
  // Multi-line output is a terminal block. A single short line is a value.
  if (fromEnvelope) {
    const lines = text.split("\n").filter((l) => l.trim().length > 0);
    if (lines.length >= 2) return "terminal";
    if (lines.length === 1 && trimmed.length <= SCALAR_MAX_CHARS) return "scalar";
  }

  if (looksLikeProse(text)) return "prose";
  if (PROSE_HINT.test(shape) && trimmed.split(/\s+/).length > 12) return "prose";

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
  | { readonly kind: "envelopeShape"; readonly shape: string }
  /** The producer reported failure (`success: false`, or an `error` field). */
  | { readonly kind: "failure"; readonly text: string | null }
  /** The wrapper's own description of what it carries (`metadata.summary`). */
  | { readonly kind: "note"; readonly text: string };

/**
 * WHICH BRANCH DECIDED. Carried on every plan because a form with no recorded
 * author cannot be graded: "scalar" tells a learner what was drawn, and only
 * `decidedBy` tells it whether that was a human's pin, an unwrapped envelope,
 * positive structural evidence, or a guess of last resort. Grading them
 * together would credit the heuristic for every pin a person set by hand.
 *
 * The field is REQUIRED rather than optional, and that is the whole of its
 * enforcement: every `return` in `planContent` must name its source or the
 * build fails, so a branch added later cannot ship anonymously.
 */
export type FormDecisionSource =
  /** Nothing arrived. */
  | "empty_preview"
  /** A human pinned this shape through `surfaceIntent`. The strongest evidence there is. */
  | "pin"
  /** Payload unwrapped from a command envelope inside a truncated preview. */
  | "truncated_envelope"
  /** A fragment. Classified conservatively and never rescued. */
  | "truncated"
  /** Not JSON: classified from the bytes alone. */
  | "unparsed"
  /** Valid JSON that is not an object — a bare number, string or boolean. */
  | "non_object"
  /** `{producedBy, executionId}` exactly: provenance, no content. */
  | "stub"
  /** One unwrap of a command envelope. */
  | "envelope"
  /** A command envelope whose payload was blank. */
  | "envelope_empty"
  /** A single-key wrapper, the key read as a label. */
  | "wrapper"
  /** Every other object. The designed landing place for shapes nobody has seen. */
  | "record"
  /** `rescueBareScalar` lifted a short single-line value off the default branch. */
  | "rescue"
  /**
   * A long string FIELD inside a record, re-planned by the recursive renderer
   * rather than by `planContent`. Distinct because it is not a decision about
   * an impulse — it is a decision about one field of one — so grading it as an
   * impulse-level form choice would double-count the record that contains it.
   */
  | "nested_field"
  /** `renderPolicy.learnedFormByShape`: a form a learner earned for this shape. */
  | "learned"
  /** `{success, shape, body}` — the resolver's reply wrapper; `body` is what is drawn. */
  | "resolver_envelope"
  /** `{success, content: "<json>"}` — content carried as an encoded string. */
  | "content_envelope"
  /** `{error}` / `{success:false, error}` — a failure reported instead of content. */
  | "error_envelope"
  /** A truncated preview of JSON: only the members received whole are drawn. */
  | "partial_json";

export interface RenderPlan {
  readonly form: ContentForm;
  /** What to draw. NOT always the preview: an unwrapped envelope draws its payload. */
  readonly text: string;
  /** Which branch chose `form`. See `FormDecisionSource`. */
  readonly decidedBy: FormDecisionSource;
  /** The key a single-key wrapper was carrying its value under. */
  readonly label?: string;
  readonly meta?: readonly MetaChip[];
  /** The `shape` field INSIDE the envelope, when it declared one. */
  readonly envelopeShape?: string;
}

/** Above this a value is not a scalar, whatever it parsed out of. */
const SCALAR_MAX_CHARS = 300;

/**
 * Rescue a bare value from the verbatim block.
 *
 * `heuristicForm` already has a scalar branch, but it is reachable ONLY with
 * `fromEnvelope` — so a one-line value that arrived off the wire rather than out
 * of a command's `stdout` fell to the default and was drawn as a code listing.
 * Measured on the live pool: 35 of 126 impulses, every `dispatch_id`,
 * `due_score`, `rhythm_id`, `execute` and `folder` among them — and a bare
 * number that was the ANSWER to the goal. The `Scalar` renderer's own header
 * names this exact failure ("putting it in a monospace block was how a one-word
 * answer came to look like a fragment of machine output"); the planner simply
 * could not route to it, because `scalar` had no path that did not run through
 * a JSON wrapper.
 *
 * THIS IS A RESCUE OF THE DEFAULT, NOT A NEW CLASSIFIER, and that distinction is
 * the whole of its safety argument. It fires only on a form that already came
 * back as `DEFAULT_CONTENT_FORM`, so it cannot take content away from `diff`,
 * `rows`, `prose` or `terminal` — every one of those has already decided by the
 * time this runs. P9 is untouched: the renderer's default branch still draws
 * verbatim, and this only narrows what arrives there.
 *
 * NEVER ON TRUNCATED CONTENT, and that is the load-bearing exclusion. A short
 * single line can be the PREFIX of something long, and `scalar` draws a
 * complete value next to a copy button — asserting that a fragment is the whole
 * value, and handing a reader a control that copies it, is precisely the
 * fidelity failure F1 exists to catch. Both call sites sit past `planContent`'s
 * `truncated` early return; adding a third above it would reintroduce the bug.
 */
function rescueBareScalar(
  form: ContentForm,
  text: string,
  decidedBy: FormDecisionSource,
): RenderPlan {
  if (form !== DEFAULT_CONTENT_FORM) return { form, text, decidedBy };
  const value = text.trim();
  if (value.length === 0 || value.length > SCALAR_MAX_CHARS) return { form, text, decidedBy };
  if (value.includes("\n")) return { form, text, decidedBy };
  // A structured opener is never a bare value. It reached the default because
  // the guard in `heuristicForm` put it there ON PURPOSE — an unparseable or
  // fragmentary JSON blob — and drawing that as one value would claim it is
  // complete when the guard exists to say it is not.
  if (value.startsWith("{") || value.startsWith("[")) return { form, text, decidedBy };
  return { form: "scalar", text, decidedBy: "rescue" };
}

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
  const code = o["exit_code"] ?? o["exitCode"];
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
/**
 * The payload of a command envelope that was cut off mid-string.
 *
 * This is NOT parsing truncated JSON, and the distinction is the whole reason
 * it is allowed. Parsing a fragment means guessing at structure that was never
 * received. Here nothing is guessed: the opening `{"shape":"…","stdout":"` is
 * matched WHOLE, so the key is known and the string's start is known, and every
 * byte after that quote up to the cut is that string's content under a decoding
 * that is fully determined. The only thing missing is the end, and the footer
 * already tells the reader this is a preview.
 *
 * It is deliberately narrow. It requires the envelope opening at position zero
 * and refuses if the payload string ever CLOSES — a closed string means the
 * object had more structure after it that this function cannot see, and that is
 * exactly the territory where a partial read becomes a guess.
 *
 * Why it exists: measured over the goals people actually type, the answers they
 * want are big. `list the running systemd units` and `read <file> and explain`
 * both blow past the 2000-character preview cap, so the truncated branch was
 * not a rare tail — it was the common case for the most useful questions, and
 * it put escaped JSON on the screen every time.
 */
/**
 * `{"shape":"X", <simple pairs>, "<payload>":"` — the payload key need not come
 * immediately after the shape.
 *
 * The intervening pairs are restricted to COMPLETE scalar values: a quoted
 * string with no escapes, a number, or a literal. That is what keeps this a
 * match rather than a parse — every byte before the payload quote is fully
 * accounted for, so the position of that quote is known rather than estimated.
 * `fileContent` puts `path` between the two, and requiring adjacency meant
 * reading a file — one of the most common things anybody asks for — still put
 * escaped JSON on the screen.
 */
/*
 * The declared shape may sit anywhere among the leading scalar pairs, not only
 * first: the LLM resolver answers `{"resolved":true,"shape":"llmCompletion",
 * "content":"…`. Requiring `shape` first meant the most common long output on
 * the surface — a written report, cut at the 2,000-character preview — drew as
 * `resolved true · shape llmCompletion · cut off here`, with the report itself
 * nowhere on screen. The guard is unchanged: every byte before the payload
 * quote is a complete scalar pair, and one of them must DECLARE a shape.
 */
const TRUNCATED_ENVELOPE =
  /^\s*\{\s*((?:"[A-Za-z_][A-Za-z0-9_]*"\s*:\s*(?:"[^"\\]*"|-?\d+(?:\.\d+)?|true|false|null)\s*,\s*)*)"(stdout|stderr|content|text|output)"\s*:\s*"/;
const DECLARED_SHAPE = /"shape"\s*:\s*"([^"\\]{1,80})"/;

export function truncatedEnvelopePayload(
  preview: string,
): { text: string; envelopeShape: string; payloadKey: string } | null {
  const m = TRUNCATED_ENVELOPE.exec(preview);
  if (!m) return null;
  const declared = DECLARED_SHAPE.exec(m[1] ?? "");
  if (!declared) return null;
  const body = preview.slice(m[0].length);
  // A closing quote means the string ENDED inside what we can see, so the cut
  // fell somewhere later in the object and there is structure here this
  // function is not entitled to interpret.
  if (/(^|[^\\])"/.test(body)) return null;
  const text = decodeJsonStringBody(body);
  if (text.trim().length === 0) return null;
  return { text, envelopeShape: declared[1] ?? "", payloadKey: m[2] ?? "" };
}

/**
 * Only a command's streams are command output. `content`/`text` carry authored
 * text — a report an LLM wrote — and are planned as text, exactly as the
 * complete `{…, content}` envelope already is (`planText`). Treating them as
 * command output drew a cut markdown report as a terminal block whose lines ran
 * off the page.
 */
function isCommandOutputKey(key: string): boolean {
  return key === "stdout" || key === "stderr" || key === "output";
}

/**
 * Decode the inside of a JSON string. Only the escapes JSON defines, and a
 * trailing lone backslash — the cut can land mid-escape — is dropped rather
 * than rendered as a stray character.
 */
function decodeJsonStringBody(raw: string): string {
  const body = raw.endsWith("\\") ? raw.slice(0, -1) : raw;
  let out = "";
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c !== "\\") {
      out += c;
      continue;
    }
    const n = body[++i];
    if (n === "n") out += "\n";
    else if (n === "t") out += "\t";
    else if (n === "r") out += "\r";
    else if (n === "b") out += "\b";
    else if (n === "f") out += "\f";
    else if (n === '"') out += '"';
    else if (n === "\\") out += "\\";
    else if (n === "/") out += "/";
    else if (n === "u") {
      const hex = body.slice(i + 1, i + 5);
      if (/^[0-9a-fA-F]{4}$/.test(hex)) {
        out += String.fromCharCode(parseInt(hex, 16));
        i += 4;
      }
    } else if (n !== undefined) {
      out += n;
    }
  }
  return out;
}

/* ─────────────────────── partial JSON (truncated previews) ──────────────── */

/**
 * The key that marks where a truncated preview was cut.
 *
 * `parsePartialJson` keeps only what arrived WHOLE — every member whose value
 * closed before the cut — and puts this key on the container the cut fell in,
 * so the renderer can say "cut off here" at the exact place it happened. The
 * earlier rule refused any read of a fragment because a half-parse presents a
 * guess as a reading. This does not half-parse: a member is either complete and
 * shown verbatim, or incomplete and dropped. Nothing is inferred about the part
 * that did not arrive, and the frame still says how much of the whole this is.
 */
export const CUT_KEY = "\u22ef";
export const CUT_NOTE = "cut off here \u2014 the rest is beyond the preview";

class Cut {
  constructor(
    readonly partial: unknown,
    readonly marked: boolean,
  ) {}
}

class PartialReader {
  private i = 0;
  constructor(private readonly s: string) {}

  private ws(): void {
    while (this.i < this.s.length && /\s/.test(this.s[this.i] as string)) this.i++;
  }
  private eof(): boolean {
    return this.i >= this.s.length;
  }

  read(): unknown {
    this.ws();
    if (this.eof()) throw new Cut(undefined, false);
    const c = this.s[this.i];
    if (c === "{") return this.object();
    if (c === "[") return this.array();
    if (c === '"') return this.string();
    return this.atom();
  }

  private string(): string {
    const start = this.i;
    this.i++;
    while (this.i < this.s.length) {
      const c = this.s[this.i];
      if (c === "\\") {
        this.i += 2;
        continue;
      }
      if (c === '"') {
        this.i++;
        return JSON.parse(this.s.slice(start, this.i)) as string;
      }
      this.i++;
    }
    throw new Cut(undefined, false);
  }

  private atom(): unknown {
    const m = /^(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/.exec(this.s.slice(this.i));
    if (!m) throw new SyntaxError(`unexpected ${this.s[this.i]} at ${this.i}`);
    this.i += m[0].length;
    // A number running into the cut may be missing digits: not received whole.
    if (this.eof()) throw new Cut(undefined, false);
    return JSON.parse(m[0]);
  }

  private object(): Record<string, unknown> {
    const o: Record<string, unknown> = {};
    const cutHere = (): never => {
      o[CUT_KEY] = CUT_NOTE;
      throw new Cut(o, true);
    };
    this.i++;
    for (;;) {
      this.ws();
      if (this.eof()) cutHere();
      if (this.s[this.i] === "}") {
        this.i++;
        return o;
      }
      let key: string;
      try {
        key = this.string();
      } catch (e) {
        if (e instanceof Cut) cutHere();
        throw e;
      }
      this.ws();
      if (this.eof()) cutHere();
      if (this.s[this.i] !== ":") throw new SyntaxError("expected :");
      this.i++;
      try {
        o[key] = this.read();
      } catch (e) {
        if (!(e instanceof Cut)) throw e;
        if (e.partial === undefined) cutHere();
        o[key] = e.partial;
        if (e.marked) throw new Cut(o, true);
        cutHere();
      }
      this.ws();
      if (this.eof()) cutHere();
      if (this.s[this.i] === ",") this.i++;
      else if (this.s[this.i] === "}") {
        this.i++;
        return o;
      } else throw new SyntaxError("expected , or }");
    }
  }

  private array(): unknown[] {
    const a: unknown[] = [];
    this.i++;
    for (;;) {
      this.ws();
      if (this.eof()) throw new Cut(a, false);
      if (this.s[this.i] === "]") {
        this.i++;
        return a;
      }
      try {
        a.push(this.read());
      } catch (e) {
        if (!(e instanceof Cut)) throw e;
        // An element cut part-way is kept only if it is a container with whole
        // members in it; a cut scalar was never received and is dropped.
        if (e.partial !== undefined) a.push(e.partial);
        throw new Cut(a, e.marked);
      }
      this.ws();
      if (this.eof()) throw new Cut(a, false);
      if (this.s[this.i] === ",") this.i++;
      else if (this.s[this.i] === "]") {
        this.i++;
        return a;
      } else throw new SyntaxError("expected , or ]");
    }
  }
}

function hasContent(v: unknown): boolean {
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object" && v !== null) return Object.keys(v).some((k) => k !== CUT_KEY);
  return false;
}

/**
 * Read the whole members of a truncated JSON preview, or null when it is not
 * JSON, is malformed before the cut, or nothing arrived whole.
 */
export function parsePartialJson(preview: string): { value: unknown; cut: boolean } | null {
  const t = preview.trim();
  if (!t.startsWith("{") && !t.startsWith("[")) return null;
  try {
    const value = new PartialReader(t).read();
    return { value, cut: false };
  } catch (e) {
    if (!(e instanceof Cut)) return null;
    if (!hasContent(e.partial)) return null;
    // A cut array with no object to carry the marker still gets one.
    return { value: e.partial, cut: true };
  }
}

/* ───────────────────────────────── the planner ───────────────────────────── */

/** Keys a resolver reply wrapper may carry around its `body`. Closed, like the command list. */
const RESOLVER_ENVELOPE_KEYS: ReadonlySet<string> = new Set(["success", "shape", "body", "error", "resolved", "metadata"]);
/** Keys a content-string wrapper may carry. */
// `resolved` is the LLM resolver's reply flag: {resolved, shape, content}.
const CONTENT_ENVELOPE_KEYS: ReadonlySet<string> = new Set(["success", "shape", "content", "error", "metadata", "resolved"]);

function failureChip(o: Readonly<Record<string, unknown>>): Extract<MetaChip, { kind: "failure" }> | null {
  const err = o["error"];
  const message =
    typeof err === "string" ? err : err && typeof err === "object" ? JSON.stringify(err) : null;
  if (o["success"] === false || message) return { kind: "failure", text: message };
  return null;
}

function withMeta(plan: RenderPlan, extra: readonly MetaChip[], decidedBy: FormDecisionSource, envelopeShape?: string): RenderPlan {
  const meta = [...extra, ...(plan.meta ?? [])];
  return {
    ...plan,
    decidedBy,
    ...(meta.length > 0 ? { meta } : {}),
    ...(envelopeShape && !plan.envelopeShape ? { envelopeShape } : {}),
  };
}

/** Plan a parsed value. `depth` bounds the wrapper unwraps; `partial` marks a cut preview. */
function planValue(shape: string, v: unknown, text: string, depth: number, partial: boolean): RenderPlan {
  if (Array.isArray(v)) {
    if (v.length === 0) return { form: "empty", text: "", decidedBy: partial ? "partial_json" : "record" };
    const objects = v.every((e) => typeof e === "object" && e !== null && !Array.isArray(e));
    return { form: objects ? "record" : DEFAULT_CONTENT_FORM, text, decidedBy: partial ? "partial_json" : "record" };
  }
  if (typeof v !== "object" || v === null) {
    return rescueBareScalar(heuristicForm(shape, text, false), text, "non_object");
  }
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o).filter((k) => k !== CUT_KEY);

  if (!partial && keys.length === 2 && typeof o["producedBy"] === "string" && typeof o["executionId"] === "string") {
    return { form: "stub", text, decidedBy: "stub" };
  }

  // The command envelope — exactly one unwrap; the payload is never re-parsed.
  const stdout = typeof o["stdout"] === "string" ? o["stdout"] : null;
  const stderr = typeof o["stderr"] === "string" ? o["stderr"] : null;
  if (!partial && (stdout !== null || stderr !== null) && isCommandEnvelope(keys)) {
    const payload = stdout !== null && stdout.length > 0 ? stdout : (stderr ?? "");
    const meta = envelopeMeta(o, shape, payload);
    const declared = typeof o["shape"] === "string" ? { envelopeShape: o["shape"] } : {};
    if (payload.trim().length === 0) {
      return { form: "empty", text: "", decidedBy: "envelope_empty", meta, ...declared };
    }
    return { form: heuristicForm(shape, payload, true), text: payload, decidedBy: "envelope", meta, ...declared };
  }

  const declaredShape = typeof o["shape"] === "string" ? (o["shape"] as string) : undefined;
  const failure = failureChip(o);
  const md = o["metadata"];
  const mdKeys = md && typeof md === "object" && !Array.isArray(md) ? Object.keys(md).filter((k) => k !== "shape" && k !== "rowCount") : [];
  const note: MetaChip | null =
    mdKeys.length === 0
      ? null
      : { kind: "note", text: mdKeys.length === 1 && typeof (md as Record<string, unknown>)["summary"] === "string"
          ? ((md as Record<string, unknown>)["summary"] as string)
          : JSON.stringify(Object.fromEntries(mdKeys.map((k) => [k, (md as Record<string, unknown>)[k]]))) };
  const failureMeta: MetaChip[] = [...(failure ? [failure] : []), ...(note ? [note] : [])];

  // The resolver reply wrapper: `{success, shape, body}`. The wrapper is transport;
  // `body` is what the resolver answered. Its facts ride as chips.
  if (depth < 3 && "body" in o && keys.every((k) => RESOLVER_ENVELOPE_KEYS.has(k)) && o["body"] !== null && o["body"] !== undefined) {
    const body = o["body"];
    const bodyText = typeof body === "string" ? body : JSON.stringify(body, null, 2);
    const inner =
      typeof body === "string"
        ? planText(shape, body, depth + 1)
        : planValue(declaredShape ?? shape, body, bodyText, depth + 1, partial && o[CUT_KEY] === undefined);
    return withMeta(inner, failureMeta, partial ? "partial_json" : "resolver_envelope", declaredShape !== shape ? declaredShape : undefined);
  }

  // `{success, content: "<encoded>"}` — the content travelled as a string.
  if (depth < 3 && typeof o["content"] === "string" && keys.every((k) => CONTENT_ENVELOPE_KEYS.has(k)) && (o["content"] as string).trim().length > 0) {
    const inner = planText(shape, o["content"] as string, depth + 1);
    return withMeta(inner, failureMeta, "content_envelope", declaredShape !== shape ? declaredShape : undefined);
  }

  // A failure reported instead of content.
  if (failure && failure.text && keys.every((k) => k === "error" || k === "success" || k === "shape")) {
    return { form: "scalar", text: failure.text, label: "error", decidedBy: "error_envelope", meta: [{ kind: "failure", text: null }] };
  }

  // The single-key wrapper: `{"goal":"…"}`. The key is a label.
  const only = keys.length === 1 ? keys[0] : undefined;
  if (!partial && only !== undefined) {
    const value = o[only];
    if (typeof value === "string" && !value.includes("\n") && value.trim().length <= SCALAR_MAX_CHARS) {
      return { form: "scalar", text: value, label: only, decidedBy: "wrapper" };
    }
  }

  return { form: "record", text, decidedBy: partial ? "partial_json" : "record", ...(failureMeta.length ? { meta: failureMeta } : {}) };
}

/** Plan a complete (not truncated) string, parsing it when it is JSON. */
function planText(shape: string, text: string, depth: number): RenderPlan {
  if (text.trim().length === 0) return { form: "empty", text: "", decidedBy: "empty_preview" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.trim());
  } catch {
    return rescueBareScalar(heuristicForm(shape, text, false), text, "unparsed");
  }
  if (typeof parsed !== "object" || parsed === null) {
    return rescueBareScalar(heuristicForm(shape, text, false), text, "non_object");
  }
  if (Array.isArray(parsed) && looksLikeRows(text)) return { form: "rows", text, decidedBy: "record" };
  return planValue(shape, parsed, text, depth, false);
}

/**
 * What to draw, and what to draw it as. The single decision point.
 *
 * Tier order, each load-bearing:
 *
 *   S0  empty short-circuits and is never overridable.
 *   S1  the human pin (`formByShape`), whole-pipeline: no unwrap, no parse.
 *   S2  the learned form (`learnedFormByShape`), same treatment, below the pin.
 *   S3  truncated: a command envelope's cut payload, else the WHOLE members of
 *       cut JSON (`parsePartialJson`), else the conservative guess.
 *   S4  complete: parse, then classify — stub, command envelope (one unwrap,
 *       never re-parsed), resolver wrapper (`body`), content wrapper, error,
 *       single-key wrapper, record.
 *   S5  the guess, on anything that is not JSON.
 */
export function planContent(
  shape: string,
  preview: string,
  truncated: boolean,
  formByShape?: Readonly<Record<string, string>>,
  learnedFormByShape?: Readonly<Record<string, string>>,
): RenderPlan {
  if (preview.trim().length === 0) return { form: "empty", text: "", decidedBy: "empty_preview" };

  const pinned = formByShape?.[shape];
  if (pinned !== undefined && isKnownForm(pinned) && isPinnable(pinned)) {
    return { form: pinned, text: preview, decidedBy: "pin" };
  }
  const learned = learnedFormByShape?.[shape];
  if (learned !== undefined && isKnownForm(learned) && isPinnable(learned)) {
    return { form: learned, text: preview, decidedBy: "learned" };
  }

  if (truncated) {
    const prefix = truncatedEnvelopePayload(preview);
    if (prefix) {
      return {
        form: heuristicForm(shape, prefix.text, isCommandOutputKey(prefix.payloadKey)),
        text: prefix.text,
        decidedBy: "truncated_envelope",
        ...(prefix.envelopeShape ? { envelopeShape: prefix.envelopeShape } : {}),
      };
    }
    const partial = parsePartialJson(preview);
    if (partial) {
      const text = JSON.stringify(partial.value, null, 2);
      const plan = planValue(shape, partial.value, text, 0, true);
      // A cut preview is never drawn as one complete value.
      if (plan.form === "scalar" || plan.form === "stub") return { form: "record", text, decidedBy: "partial_json" };
      return plan;
    }
    return { form: heuristicForm(shape, preview, false), text: preview, decidedBy: "truncated" };
  }

  return planText(shape, preview, 0);
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
