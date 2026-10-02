/**
 * Answers to escalated gaps, built to the contract of the reader that applies them.
 *
 * The reader is development-vessel `escalation_disposition_apply`
 * (src/resolvers/escalation-disposition-apply.ts). It takes the latest non-dismiss
 * answer on a `needs-human-*` / `reland-needs-human-*` panel, finds a verb anywhere in
 * the text with `parseDisposition` — first match in the order redefine, grant access,
 * provide information, drop — and applies it to the gap, together with any
 * `EDIT_SITE:` / `VERIFY_SHAPE:` / `EXPECTED_LITERAL:` lines. An answer with no verb
 * is left unparsed and changes nothing.
 *
 * `parseDisposition` below is a BYTE MIRROR of that function, pinned by
 * test/disposition.test.ts. The surface runs it before sending so that an answer
 * which the reader would apply as a different verb than the one chosen is refused
 * here, instead of being applied wrongly there.
 */

export type DispositionVerb = "drop" | "redefine" | "provide_information" | "grant_access";

// ── mirror: begin (must equal the reader's function text) ──
export function parseDisposition(answer: string): DispositionVerb | null {
  const t = String(answer ?? "").toLowerCase();
  if (!t.trim()) return null;
  if (/\bredefine\b|\bre-define\b|\brescope\b|\breword\b/.test(t)) return "redefine";
  if (/\bgrant[\s_-]+access\b|\baccess\s+granted\b|\bcredential/.test(t)) return "grant_access";
  if (/\bprovide[sd]?[\s_-]+(missing[\s_-]+)?info(rmation)?\b|\bmissing\s+info(rmation)?\b|\bhere'?s\s+the\s+fact\b|\bstore\s+the\s+answer\s+as\s+prose\b/.test(t)) {
    return "provide_information";
  }
  if (/\bdrop\b|\bwon'?t\s+fix\b|\bwontfix\b|\bnot\s+worth\s+closing\b|\babandon\b/.test(t)) return "drop";
  return null;
}
// ── mirror: end ──

/** The four decisions, in the order a person reads them. `phrase` is a literal the parser matches. */
export const DISPOSITIONS: readonly { verb: DispositionVerb; phrase: string; label: string; hint: string }[] = [
  { verb: "redefine", phrase: "redefine", label: "Redefine the goal", hint: "the goal is wrong or too broad" },
  { verb: "provide_information", phrase: "provide missing information", label: "Provide missing information", hint: "here is the fact it lacks" },
  { verb: "grant_access", phrase: "grant access", label: "Grant access", hint: "it needs a credential or permission" },
  { verb: "drop", phrase: "drop", label: "Drop it", hint: "not worth closing — closes the gap" },
];

export function dispositionLabel(verb: string | null | undefined): string {
  return DISPOSITIONS.find((d) => d.verb === verb)?.label ?? String(verb ?? "");
}

export interface EscalationAnswer {
  readonly verb: DispositionVerb;
  readonly details: string;
  readonly editSite?: string;
  readonly verifyShape?: string;
}

/** The text the reader receives: the verb phrase, the details, then labelled lines. */
export function buildEscalationAnswer(a: EscalationAnswer): string {
  const phrase = DISPOSITIONS.find((d) => d.verb === a.verb)?.phrase ?? a.verb;
  const lines = [phrase];
  const details = a.details.trim();
  if (details) lines.push(details);
  if (a.editSite?.trim()) lines.push(`EDIT_SITE: ${a.editSite.trim()}`);
  if (a.verifyShape?.trim()) lines.push(`VERIFY_SHAPE: ${a.verifyShape.trim()}`);
  return lines.join("\n");
}

export type AnswerProblem =
  | { readonly kind: "verb_flip"; readonly readAs: DispositionVerb | null }
  | { readonly kind: "edit_site"; readonly message: string }
  | { readonly kind: "verify_shape"; readonly message: string };

/**
 * Why the reader would not apply this answer as chosen, or null when it would.
 * The field rules are the reader's own: an edit site is taken only when it starts
 * with `repos/` and contains no `..`; a verify shape only when it is an identifier.
 */
export function checkEscalationAnswer(a: EscalationAnswer): AnswerProblem | null {
  const site = a.editSite?.trim() ?? "";
  if (site && (!site.startsWith("repos/") || site.includes("..") || /\s/.test(site))) {
    return { kind: "edit_site", message: "A change site must be a path starting with repos/, with no spaces or '..'." };
  }
  const shape = a.verifyShape?.trim() ?? "";
  if (shape && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(shape)) {
    return { kind: "verify_shape", message: "A verify shape is a single identifier, such as web_search." };
  }
  const readAs = parseDisposition(buildEscalationAnswer(a));
  return readAs === a.verb ? null : { kind: "verb_flip", readAs };
}

/** Which reader, if any, consumes answers to this panel. Keyed on the panel id prefix the writers use. */
export type AnswerReader = "escalation" | "pending_verification" | "localization" | "docs_decision" | "unknown";

export function answerReaderFor(panelId: string): AnswerReader {
  if (panelId.startsWith("needs-human-") || panelId.startsWith("reland-needs-human-")) return "escalation";
  if (panelId.startsWith("pending-verify-")) return "pending_verification";
  if (panelId.startsWith("needs-localization-")) return "localization";
  if (panelId.startsWith("docs-decision-")) return "docs_decision";
  return "unknown";
}

/** The gap an escalation panel is about — the reader's own `gapIdFromPanelId` rule. */
export function gapIdForPanel(panelId: string): string | null {
  if (panelId.startsWith("reland-needs-human-")) return panelId.slice("reland-needs-human-".length);
  if (panelId.startsWith("needs-human-")) return panelId.slice("needs-human-".length);
  return null;
}

/** Kinds whose answers are stored but read by nothing on this surface's path. */
export function answersAreUnread(reader: AnswerReader): boolean {
  return reader === "pending_verification" || reader === "localization" || reader === "docs_decision";
}

/** Choices for "did the fix work?" — typed now so answers are machine-readable when a reader lands. */
export const VERIFICATION_CHOICES = ["fixed", "inert", "wrong_change", "cant_tell"] as const;
export const VERIFICATION_LABELS: Readonly<Record<string, string>> = {
  fixed: "Fixed it",
  inert: "Inert — nothing changed",
  wrong_change: "Wrong change",
  cant_tell: "Can't tell",
};

/** The gap's record of an applied disposition, as the reader writes it. */
export interface AppliedDisposition {
  readonly verb: string | null;
  readonly recordId: string | null;
  readonly at: string | null;
  readonly status: string | null;
  readonly editSite: string | null;
  readonly attemptsRemaining: number | null;
}

export function appliedDisposition(gap: { status?: unknown; classification_metadata?: unknown } | null): AppliedDisposition | null {
  if (!gap) return null;
  const m = (gap.classification_metadata && typeof gap.classification_metadata === "object" ? gap.classification_metadata : {}) as Record<string, unknown>;
  const s = (k: string): string | null => (typeof m[k] === "string" ? (m[k] as string) : null);
  return {
    verb: s("human_disposition"),
    recordId: s("human_disposition_record_id"),
    at: s("human_disposition_at"),
    status: typeof gap.status === "string" ? gap.status : null,
    editSite: s("edit_site"),
    attemptsRemaining: typeof m["human_exemption_attempts_remaining"] === "number" ? (m["human_exemption_attempts_remaining"] as number) : null,
  };
}

export type AnswerOutcome =
  | { readonly kind: "applied"; readonly applied: AppliedDisposition }
  | { readonly kind: "superseded"; readonly applied: AppliedDisposition }
  | { readonly kind: "waiting" };

/** What happened to the answer with this record id, read from the gap. */
export function outcomeOf(responseId: string, sentAtMs: number, applied: AppliedDisposition | null): AnswerOutcome {
  if (applied?.recordId && applied.recordId === responseId) return { kind: "applied", applied };
  const at = applied?.at ? Date.parse(applied.at) : NaN;
  if (applied?.recordId && Number.isFinite(at) && at > sentAtMs) return { kind: "superseded", applied };
  return { kind: "waiting" };
}
