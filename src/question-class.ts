/**
 * Which questions are asks, and which reader takes each answer.
 *
 * Shared by the server (ui-view: the questions rail in `human_surface:ui_view`)
 * and the browser bundle (ui/src/lib/questionClass, ui/src/lib/disposition).
 * It lives under src/ because the deployed tree carries src/ and ui/dist only:
 * a server import from ui/src does not exist at runtime.
 *
 * An ask is something a person can act on and something reads the answer. The
 * rest still reaches the rail, folded below the asks and not counted as
 * waiting: a notice asks nothing, an answer no reader takes goes nowhere, and a
 * malformed question (no body and nothing to answer, or a template the writer
 * never rendered) gives a person nothing to act on.
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

/** The prefixes gap askers write panel ids with; the rest of the id is the gap's. Longest first. */
const GAP_PANEL_PREFIXES = ["reland-needs-human-", "needs-human-", "pending-verify-", "needs-localization-"] as const;

/** The gap a panel asks about, read off its writer's id prefix; null for a panel that names none. */
export function gapIdForPanel(panelId: string): string | null {
  for (const prefix of GAP_PANEL_PREFIXES) {
    if (panelId.startsWith(prefix)) return panelId.length > prefix.length ? panelId.slice(prefix.length) : null;
  }
  return null;
}

/** Kinds whose answers are stored but read by nothing on this surface's path. */
export function answersAreUnread(reader: AnswerReader): boolean {
  return reader === "pending_verification" || reader === "localization" || reader === "docs_decision";
}

export type QuestionClass = "ask" | "notice" | "settled" | "unread" | "malformed";

const UNRENDERED = /\{\{[^}]*\}\}/;

function bodyText(question: Pick<ClassifiableQuestion, "body">): string {
  if (typeof question.body === "string") return question.body;
  if (question.body === null || question.body === undefined) return "";
  return JSON.stringify(question.body);
}

/** Why a question gives a person nothing to act on, or null when it does not fail that way. */
export function malformedReason(question: ClassifiableQuestion): "unrendered_template" | "empty" | null {
  if (UNRENDERED.test(question.id) || UNRENDERED.test(question.title) || UNRENDERED.test(question.kind ?? "")) return "unrendered_template";
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
  if (answersAreUnread(answerReaderFor(question.id))) return "unread";
  return "ask";
}

/** The folded groups, in the order they follow the asks. */
export const FOLDED: readonly { cls: Exclude<QuestionClass, "ask">; label: string }[] = [
  { cls: "notice", label: "Notices" },
  { cls: "settled", label: "Gap closed" },
  { cls: "unread", label: "No reader" },
  { cls: "malformed", label: "Malformed" },
];

/** The part of a gap question's body before its truncated `Summary:` clause. */
export function bodyLead(question: Pick<ClassifiableQuestion, "body">): string {
  const body = bodyText(question);
  const at = body.indexOf("Summary:");
  return (at >= 0 ? body.slice(0, at) : body).trim();
}
