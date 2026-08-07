/**
 * surfaceIntent — prose typed by a human becomes a renderPolicy patch.
 *
 * WHY THIS IS DETERMINISTIC FIRST. The substrate's rule is that the LLM is one
 * resolver among many and never the controller. A human asking for bigger text
 * is not a reasoning problem; it is a parse. So this module parses, and what it
 * cannot parse it REPORTS as unparsed — with the vocabulary it does understand
 * and a goal text the reader may choose to dispatch. It never silently drops a
 * clause, and it never reports a no-op as success. An escalation to an LLM is
 * therefore an explicit, visible, human-taken step (P2: a suggestion inserts,
 * it never dispatches), not a hidden fallback that launders failure into green.
 *
 * WHY IT IS NOT A BEHAVIOUR GATE (law 1). Nothing here decides how the surface
 * renders. It only translates prose into the `renderPolicy` impulse, which the
 * surface reads at use time. Change the impulse by any other route and the
 * surface changes identically; delete this module and rendering is unaffected.
 * The numbers below (12px, 14.5px, …) are not policy: they are a transcript of
 * the shipped defaults in `packages/design-tokens/tokens.css`, needed only so a
 * relative instruction ("bigger") has something to be relative TO when no
 * override is in force yet. `src/` cannot import that package, so they are
 * mirrored here and named as a mirror.
 *
 * MERGE, NEVER REPLACE. `writeRenderPolicy` swaps whole maps: passing
 * `formByShape` replaces every pin, not just the named one. Every read here
 * starts from the LIVE policy and merges into a copy, so one person's
 * instruction cannot silently delete another's override.
 */

import type { RenderPolicy } from "./store.js";

/* ── the closed form vocabulary ─────────────────────────────────────────────
 * Mirrors `CONTENT_FORMS` in `packages/design-tokens`. The surface dispatches
 * on FORM, never on shape (P9), and the set is closed on purpose — a form the
 * renderer does not know falls through to verbatim, so accepting an unknown
 * form word here would produce a silent no-op on screen. It is refused instead.
 */
export const CONTENT_FORMS = ["prose", "text", "rows", "diff", "empty"] as const;
export type ContentForm = (typeof CONTENT_FORMS)[number];

/** How a human names each form. Left side is what people type. */
const FORM_WORDS: ReadonlyArray<readonly [RegExp, ContentForm]> = [
  [/^(?:a\s+|an\s+|the\s+)?(?:tables?|tabular|rows?|grid|columns?|spreadsheet)$/i, "rows"],
  [/^(?:a\s+|an\s+|the\s+)?(?:prose|paragraphs?|markdown|writing|readable)$/i, "prose"],
  [/^(?:a\s+|an\s+|the\s+)?(?:verbatim|raw|literal|monospace|mono|code|plain|text|preformatted)$/i, "text"],
  [/^(?:a\s+|an\s+|the\s+)?(?:diffs?|patch(?:es)?|changes?)$/i, "diff"],
];

function formWord(word: string): ContentForm | null {
  for (const [re, form] of FORM_WORDS) if (re.test(word.trim())) return form;
  return null;
}

/* ── the token scales ───────────────────────────────────────────────────────
 * A transcript of `tokens.css`, not a decision. See the file header.
 */
const TEXT_TOKENS: ReadonlyArray<readonly [string, number]> = [
  ["--sf-text-xs", 12],
  ["--sf-text-sm", 12.5],
  ["--sf-text-base", 14.5],
  ["--sf-text-lg", 17],
  ["--sf-text-xl", 21],
  ["--sf-text-2xl", 27],
];
const SPACE_TOKENS: ReadonlyArray<readonly [string, number]> = [
  ["--sf-space-1", 4],
  ["--sf-space-2", 7],
  ["--sf-space-3", 11],
  ["--sf-space-4", 14],
  ["--sf-space-5", 18],
  ["--sf-space-6", 26],
  ["--sf-space-7", 34],
];

/**
 * Bounds, and they are refusals rather than silent corrections: a clamp is
 * reported in the change it constrained. Below ~9px the surface stops being
 * readable, which is the failure this whole path exists to fix; above ~40px a
 * fixed-height live region (P6/`--sf-live-region-height`) starts clipping rows,
 * which is the failure of moving a reader's target out from under them.
 */
const TEXT_MIN_PX = 9;
const TEXT_MAX_PX = 40;
const SPACE_MIN_PX = 2;
const SPACE_MAX_PX = 64;

/* ── result types ──────────────────────────────────────────────────────────── */

export interface IntentChange {
  /** What moved, in the policy's own vocabulary. */
  readonly field: string;
  readonly from: string;
  readonly to: string;
  /** The clause that caused it — so a reader can see WHICH words did WHAT. */
  readonly because: string;
  /** Set when a bound constrained the request. Never silently applied. */
  readonly clamped?: string;
  /** The concrete values written, when the change moved a whole scale. */
  readonly detail?: Readonly<Record<string, string>>;
}

export interface UnparsedClause {
  readonly text: string;
  readonly reason: string;
  /**
   * The clause WAS read; it just asks for the state already in force. It is
   * reported here rather than in `changes` because nothing moved, and a
   * no-op must never be dressed as a change — but it is flagged so a reader
   * is not told their English was unreadable when it was merely redundant.
   */
  readonly no_op?: true;
  /**
   * A goal a human MAY choose to send. This module does not dispatch it and
   * must never be changed to (P2).
   */
  readonly suggested_goal: string;
}

export interface RenderPolicyPatch {
  tokenOverrides?: Record<string, string>;
  formByShape?: Record<string, string>;
  maxPreviewChars?: number | null;
  ledgerDefaultExpanded?: boolean;
  note?: string | null;
}

export interface IntentReading {
  readonly text: string;
  readonly changes: readonly IntentChange[];
  readonly unparsed: readonly UnparsedClause[];
  /** True when at least one clause moved the policy. */
  readonly understood: boolean;
  readonly patch: RenderPolicyPatch;
  /** What this parser can read, offered whenever something was not read. */
  readonly grammar: readonly string[];
}

export const GRAMMAR: readonly string[] = [
  "make the text bigger / smaller (add 'much' or 'a bit' to change the step)",
  "set the text to 16px",
  "show <shape> as a table | rows | prose | verbatim | diff",
  "stop overriding <shape> (drop one form pin)",
  "make it denser / tighter / looser / roomier",
  "expand the ledger / collapse the ledger",
  "preview 800 characters / show everything in full",
  "reset to defaults (undo every override)",
];

/* ── helpers ───────────────────────────────────────────────────────────────── */

function px(n: number): string {
  return `${Math.round(n * 100) / 100}px`;
}

function currentPx(token: string, defaultPx: number, overrides: Record<string, string>): number {
  const raw = overrides[token];
  if (typeof raw === "string") {
    const m = /^(-?\d+(?:\.\d+)?)px$/.exec(raw.trim());
    if (m && m[1] !== undefined) {
      const n = parseFloat(m[1]);
      if (Number.isFinite(n)) return n;
    }
  }
  return defaultPx;
}

interface ScaleResult {
  readonly detail: Record<string, string>;
  readonly clamped: boolean;
  readonly fromBase: number;
  readonly toBase: number;
}

function scaleTokens(
  tokens: ReadonlyArray<readonly [string, number]>,
  overrides: Record<string, string>,
  factor: number,
  minPx: number,
  maxPx: number,
  baseToken: string,
): ScaleResult {
  const detail: Record<string, string> = {};
  let clamped = false;
  let fromBase = 0;
  let toBase = 0;
  for (const [token, dflt] of tokens) {
    const before = currentPx(token, dflt, overrides);
    const wanted = before * factor;
    const after = Math.min(maxPx, Math.max(minPx, wanted));
    if (Math.abs(after - wanted) > 0.01) clamped = true;
    overrides[token] = px(after);
    detail[token] = px(after);
    if (token === baseToken) {
      fromBase = before;
      toBase = after;
    }
  }
  return { detail, clamped, fromBase, toBase };
}

/**
 * Clause splitting. Conjunctions and punctuation separate instructions; the
 * decimal point does not, which is why `.` is only a separator when followed by
 * whitespace or end.
 */
function clauses(text: string): string[] {
  return text
    .split(/\s*(?:[;\n]+|,|\.(?=\s|$)|\band\b|\bthen\b|\balso\b|\bplus\b)\s*/i)
    .map((c) =>
      c
        .replace(
          /^(?:please\s+|can you\s+|could you\s+|i(?:'d| would)? (?:like|want)(?: you)?(?: to)?\s+|you should\s+|just\s+)+/i,
          "",
        )
        .trim(),
    )
    .filter((c) => c.length > 0 && !/^(?:please|thanks|thank you|ok|okay)$/i.test(c));
}

/** Words that name no shape — "show everything as prose" cannot be honoured. */
const NON_SHAPE = /^(?:everything|all|it|them|things?|stuff|content|impulses?|output|results?|this|that)$/i;

function stepFactor(clause: string, up: boolean): number {
  const much = /\b(?:much|way|far|a lot|lots|significantly|considerably)\b/i.test(clause);
  const bit = /\b(?:a bit|a little|slightly|somewhat|marginally|touch)\b/i.test(clause);
  const step = much ? 1.32 : bit ? 1.07 : 1.16;
  return up ? step : 1 / step;
}

/* ── the parse ─────────────────────────────────────────────────────────────── */

/**
 * Read prose against the LIVE policy and return what it would change.
 *
 * Pure: it writes nothing. The caller applies `patch` through
 * `writeRenderPolicy`, so the change lands as a shaped impulse the surface
 * reads at use time, exactly as any other author of that impulse would.
 */
export function readSurfaceIntent(text: string, current: RenderPolicy): IntentReading {
  const changes: IntentChange[] = [];
  const unparsed: UnparsedClause[] = [];

  // MERGE, never replace — start from what is already in force.
  const tokenOverrides: Record<string, string> = { ...current.tokenOverrides };
  const formByShape: Record<string, string> = { ...current.formByShape };
  let maxPreviewChars: number | null = current.maxPreviewChars;
  let ledgerDefaultExpanded: boolean = current.ledgerDefaultExpanded;
  let touchedTokens = false;
  let touchedForms = false;
  let touchedPreview = false;
  let touchedLedger = false;
  let reset = false;

  for (const clause of clauses(text)) {
    const c = clause.toLowerCase();

    /* 1. global reset — checked first so "reset the text size" does not scale. */
    if (
      /\b(?:reset|undo|revert|restore|clear)\b/.test(c) &&
      (/\b(?:default|defaults|normal|original|everything|all|it)\b/.test(c) ||
        /^(?:reset|undo|revert)$/.test(c.trim()))
    ) {
      for (const k of Object.keys(tokenOverrides)) delete tokenOverrides[k];
      for (const k of Object.keys(formByShape)) delete formByShape[k];
      maxPreviewChars = null;
      ledgerDefaultExpanded = true;
      touchedTokens = touchedForms = touchedPreview = touchedLedger = reset = true;
      changes.push({
        field: "renderPolicy",
        from: `${Object.keys(current.tokenOverrides).length} token override(s), ${Object.keys(current.formByShape).length} form pin(s)`,
        to: "no overrides — the built-in heuristic is back in force",
        because: clause,
      });
      continue;
    }

    /* 2. drop ONE form pin. */
    const unpin =
      /\b(?:stop overriding|unpin|un-pin|stop pinning|reset|clear)\s+(?:the\s+)?([a-z_][a-z0-9_:.\-]*)/i.exec(
        clause,
      );
    if (unpin && unpin[1] !== undefined && !NON_SHAPE.test(unpin[1])) {
      const shape = unpin[1];
      if (formByShape[shape] === undefined) {
        unparsed.push({
          text: clause,
          reason: `no form is pinned for '${shape}', so there is nothing to drop`,
          no_op: true,
          suggested_goal: `Report which shapes currently have a pinned render form on the human surface`,
        });
      } else {
        const before = formByShape[shape];
        delete formByShape[shape];
        touchedForms = true;
        changes.push({
          field: `formByShape.${shape}`,
          from: before,
          to: "(unset — the built-in heuristic decides again)",
          because: clause,
        });
      }
      continue;
    }

    /* 3. "show <shape> as <form>" */
    const formMatch =
      /\b(?:show|render|display|format|present|draw|lay ?out)\s+(?:the\s+)?([a-z_][a-z0-9_:.\-]*)\s*(?:impulses?|results?|outputs?|entries)?\s+(?:as|in|like|using)\s+(.+)$/i.exec(
        clause,
      );
    if (formMatch && formMatch[1] !== undefined && formMatch[2] !== undefined) {
      const shapeWord = formMatch[1];
      // The article belongs to the sentence, not to the form name — carrying it
      // into the refusal produces "'a hologram' is not a form", which reads as
      // if the parser did not understand English rather than the word.
      const rest = formMatch[2].trim().replace(/^(?:an?|the)\s+/i, "");
      if (NON_SHAPE.test(shapeWord)) {
        unparsed.push({
          text: clause,
          reason: `'${shapeWord}' does not name a shape — a form is pinned per shape (e.g. "show shellResult as rows"), and there is no wildcard pin`,
          suggested_goal: `List the impulse shapes the human surface has rendered recently so a render form can be chosen per shape`,
        });
        continue;
      }
      const form = formWord(rest);
      if (form === null) {
        unparsed.push({
          text: clause,
          reason: `'${rest}' is not a form this surface can render — the forms are ${CONTENT_FORMS.join(", ")}`,
          suggested_goal: `Add a '${rest}' content form to the human surface renderer in repos/human-surface-vessel/ui/src/components/ContentRender.tsx`,
        });
        continue;
      }
      if (form === "empty") {
        unparsed.push({
          text: clause,
          reason: `'empty' is a fact about content, not a presentation choice — it cannot be pinned`,
          suggested_goal: "",
        });
        continue;
      }
      const before = formByShape[shapeWord];
      formByShape[shapeWord] = form;
      touchedForms = true;
      changes.push({
        field: `formByShape.${shapeWord}`,
        from: before ?? "(unset — decided by the built-in heuristic)",
        to: form,
        because: clause,
      });
      continue;
    }

    /* 4. a named text size. */
    const sizeMatch = /\b(\d+(?:\.\d+)?)\s*(?:px|pixels?|pt)?\b/.exec(c);
    if (
      sizeMatch &&
      sizeMatch[1] !== undefined &&
      /\b(?:text|font|type|size|typeface|letters?)\b/.test(c) &&
      !/\b(?:preview|character|char|truncat)/.test(c)
    ) {
      const wanted = parseFloat(sizeMatch[1]);
      const base = currentPx("--sf-text-base", 14.5, tokenOverrides);
      if (!Number.isFinite(wanted) || wanted <= 0) {
        unparsed.push({
          text: clause,
          reason: `'${sizeMatch[1]}' is not a usable size`,
          suggested_goal: "",
        });
        continue;
      }
      const res = scaleTokens(
        TEXT_TOKENS,
        tokenOverrides,
        wanted / base,
        TEXT_MIN_PX,
        TEXT_MAX_PX,
        "--sf-text-base",
      );
      touchedTokens = true;
      changes.push({
        field: "tokenOverrides (type scale)",
        from: `${px(res.fromBase)} base`,
        to: `${px(res.toBase)} base`,
        because: clause,
        ...(res.clamped
          ? { clamped: `held inside ${TEXT_MIN_PX}–${TEXT_MAX_PX}px; the scale is compressed at the ends` }
          : {}),
        detail: res.detail,
      });
      continue;
    }

    /* 5. relative text size. Density words are excluded — they are rule 6. */
    const wantsBigger = /\b(?:bigger|larger|large|big|huge|increase|grow|enlarge|zoom in)\b/.test(c);
    const wantsSmaller = /\b(?:smaller|small|tiny|tinier|reduce|shrink|decrease|zoom out)\b/.test(c);
    const aboutSpacing = /\b(?:space|spacing|spaced|gap|gaps|padding|margin|denser|looser)\b/.test(c);
    if ((wantsBigger || wantsSmaller) && !aboutSpacing) {
      if (wantsBigger && wantsSmaller) {
        unparsed.push({
          text: clause,
          reason: "this asks for bigger and smaller at once",
          suggested_goal: "",
        });
        continue;
      }
      const res = scaleTokens(
        TEXT_TOKENS,
        tokenOverrides,
        stepFactor(c, wantsBigger),
        TEXT_MIN_PX,
        TEXT_MAX_PX,
        "--sf-text-base",
      );
      touchedTokens = true;
      changes.push({
        field: "tokenOverrides (type scale)",
        from: `${px(res.fromBase)} base`,
        to: `${px(res.toBase)} base`,
        because: clause,
        ...(res.clamped
          ? { clamped: `held inside ${TEXT_MIN_PX}–${TEXT_MAX_PX}px — already at the bound` }
          : {}),
        detail: res.detail,
      });
      continue;
    }

    /* 6. density. */
    const denser = /\b(?:denser|dense|tighter|tight|compact|condensed|cramped|closer)\b/.test(c);
    const looser =
      /\b(?:looser|loose|roomier|airier|spacious|breathing room|more space|more spacing|relaxed|open it up)\b/.test(
        c,
      );
    if (denser !== looser) {
      const res = scaleTokens(
        SPACE_TOKENS,
        tokenOverrides,
        denser ? 1 / 1.25 : 1.25,
        SPACE_MIN_PX,
        SPACE_MAX_PX,
        "--sf-space-3",
      );
      touchedTokens = true;
      changes.push({
        field: "tokenOverrides (spacing scale)",
        from: `${px(res.fromBase)} step`,
        to: `${px(res.toBase)} step`,
        because: clause,
        ...(res.clamped
          ? { clamped: `held inside ${SPACE_MIN_PX}–${SPACE_MAX_PX}px — already at the bound` }
          : {}),
        detail: res.detail,
      });
      continue;
    }

    /* 7. the ledger's default state.
     * "show everything in full" is about the PREVIEW CAP, not the ledger, so a
     * clause carrying preview vocabulary is left for rule 8. */
    const opens = /\b(?:expand|open|unfold|show)\b/.test(c);
    const closes = /\b(?:collapse|close|fold|hide|shut)\b/.test(c);
    const previewish = /\b(?:preview|truncat\w*|cap|cut off|characters?|chars|in full|full text)\b/.test(c);
    const ledgerish = /\b(?:ledger|evidence|entries|detail|details|everything)\b/.test(c);
    if (ledgerish && !previewish && opens !== closes) {
      const next = opens;
      if (ledgerDefaultExpanded === next) {
        unparsed.push({
          text: clause,
          reason: `the ledger is already ${next ? "expanded" : "collapsed"} by default — nothing to change`,
          no_op: true,
          suggested_goal: "",
        });
        continue;
      }
      changes.push({
        field: "ledgerDefaultExpanded",
        from: String(ledgerDefaultExpanded),
        to: String(next),
        because: clause,
      });
      ledgerDefaultExpanded = next;
      touchedLedger = true;
      continue;
    }

    /* 8. preview length. */
    if (previewish) {
      const noCap =
        /\b(?:no|without|remove|drop|stop|never)\b/.test(c) || /\b(?:in full|full text|everything)\b/.test(c);
      const n = /\b(\d+)\b/.exec(c);
      if (n && n[1] !== undefined && !noCap) {
        const wanted = parseInt(n[1], 10);
        const next = Math.max(80, Math.min(20000, wanted));
        changes.push({
          field: "maxPreviewChars",
          from: maxPreviewChars === null ? "(no cap)" : String(maxPreviewChars),
          to: String(next),
          because: clause,
          ...(next !== wanted ? { clamped: "held inside 80–20000 characters" } : {}),
        });
        maxPreviewChars = next;
        touchedPreview = true;
        continue;
      }
      if (noCap) {
        if (maxPreviewChars === null) {
          unparsed.push({
            text: clause,
            reason: "there is no preview cap in force — nothing to remove",
            no_op: true,
            suggested_goal: "",
          });
          continue;
        }
        changes.push({
          field: "maxPreviewChars",
          from: String(maxPreviewChars),
          to: "(no cap)",
          because: clause,
        });
        maxPreviewChars = null;
        touchedPreview = true;
        continue;
      }
    }

    /* Nothing matched. Say so — this is the whole point of the module. */
    unparsed.push({
      text: clause,
      reason: "no rule in this parser reads this instruction",
      suggested_goal: `Change the human surface so that: ${clause}`,
    });
  }

  const patch: RenderPolicyPatch = {
    ...(touchedTokens ? { tokenOverrides } : {}),
    ...(touchedForms ? { formByShape } : {}),
    ...(touchedPreview ? { maxPreviewChars } : {}),
    ...(touchedLedger ? { ledgerDefaultExpanded } : {}),
    note: reset
      ? "reset to defaults by a typed instruction"
      : `typed instruction: ${text.trim().slice(0, 240)}`,
  };

  return {
    text,
    changes,
    unparsed,
    understood: changes.length > 0,
    patch,
    grammar: GRAMMAR,
  };
}
