/**
 * Which questions are asks.
 *
 * Shared by the server (ui-view: the questions rail in `human_surface:ui_view`)
 * and the browser bundle (ui/src/lib/questionClass).
 * It lives under src/ because the deployed tree carries src/ and ui/dist only:
 * a server import from ui/src does not exist at runtime.
 *
 * An ask is something a person can act on and something reads the answer. The
 * rest still reaches the rail, folded below the asks and not counted as
 * waiting: a notice asks nothing, an answer no reader takes goes nowhere, and a
 * malformed question (no body and nothing to answer, or a template the writer
 * never rendered) gives a person nothing to act on.
 *
 * The reader is what the question's writer declared (`reader`, the shape that
 * takes the answer), and it counts only while discovery lists that shape
 * (`readerListed`, set by the read from discovery's registry). Nothing here
 * infers a reader from a question's id or kind: a table that did so kept asks
 * waiting on a person after the vessel that read their answers had left.
 */

/** The fields of a question this module reads. */
export interface ClassifiableQuestion {
  readonly id: string;
  readonly title: string;
  readonly kind?: string;
  readonly body: unknown;
  readonly asks?: readonly unknown[];
  readonly run?: { readonly linked?: boolean };
  /** The status of the gap the question is about, when the gap store has said; absent or null when not known. */
  readonly gapStatus?: string | null;
  /** The shape that takes the answer, as the writer declared it. */
  readonly reader?: string;
  /** Whether discovery listed `reader` when the question was read. Absent: not checked, so not listed. */
  readonly readerListed?: boolean;
}

/** The prefixes gap askers write panel ids with; the rest of the id is the gap's. Longest first. */
const GAP_PANEL_PREFIXES = ["reland-needs-human-", "needs-human-", "pending-verify-", "needs-localization-"] as const;

/** The gap a panel asks about, read off its writer's id prefix; null for a panel that names none. */
export function gapIdForPanel(panelId: string): string | null {
  for (const prefix of GAP_PANEL_PREFIXES) {
    if (panelId.startsWith(prefix)) return panelId.length > prefix.length ? panelId.slice(prefix.length) : null;
  }
  return null;
}

export type QuestionClass = "ask" | "notice" | "settled" | "unread" | "malformed";

const UNRENDERED = /\{\{[^}]*\}\}/;

/**
 * Whether a naming text is still a template placeholder its writer never filled ("{{goal.id}}").
 * The one predicate: the reader classes such a question malformed, and the write doors refuse it.
 */
export function isUnfilledTemplate(text: string): boolean {
  return UNRENDERED.test(text);
}

function bodyText(question: Pick<ClassifiableQuestion, "body">): string {
  if (typeof question.body === "string") return question.body;
  if (question.body === null || question.body === undefined) return "";
  return JSON.stringify(question.body);
}

/** Why a question gives a person nothing to act on, or null when it does not fail that way. */
export function malformedReason(question: ClassifiableQuestion): "unrendered_template" | "empty" | null {
  if (isUnfilledTemplate(question.id) || isUnfilledTemplate(question.title) || isUnfilledTemplate(question.kind ?? "")) return "unrendered_template";
  const text = bodyText(question).trim();
  const empty = text === "" || text === "{}";
  if (empty && !(question.asks && question.asks.length > 0) && question.run?.linked !== true) return "empty";
  return null;
}

export function classifyQuestion(question: ClassifiableQuestion): QuestionClass {
  if (malformedReason(question) !== null) return "malformed";
  if (question.kind === "notice") return "notice";
  // The gap it asks about has closed: an answer would decide nothing. Unknown is not closed.
  if (typeof question.gapStatus === "string" && question.gapStatus !== "open") return "settled";
  if (question.readerListed !== true) return "unread";
  return "ask";
}

/** The folded groups, in the order they follow the asks. */
export const FOLDED: readonly { cls: Exclude<QuestionClass, "ask">; label: string }[] = [
  // Each label says no more than its predicate in classifyQuestion tests.
  { cls: "notice", label: "For your information" },
  { cls: "settled", label: "Its gap is no longer open" },
  { cls: "unread", label: "No reader listed for your answer" },
  { cls: "malformed", label: "Empty or unfilled: nothing to answer" },
];

/** The part of a gap question's body before its truncated `Summary:` clause. */
export function bodyLead(question: Pick<ClassifiableQuestion, "body">): string {
  const body = bodyText(question);
  const at = body.indexOf("Summary:");
  return (at >= 0 ? body.slice(0, at) : body).trim();
}
