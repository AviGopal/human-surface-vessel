/**
 * Which questions are asks.
 *
 * An ask is something a person can act on and something reads the answer. The
 * rest still reaches the rail, folded below the asks and not counted as
 * waiting: a notice asks nothing, an answer no reader takes goes nowhere, and a
 * malformed question (no body and nothing to answer, or a template the writer
 * never rendered) gives a person nothing to act on.
 */

import type { Question } from "../api/participation";
import { answerReaderFor, answersAreUnread } from "./disposition";

export type QuestionClass = "ask" | "notice" | "unread" | "malformed";

const UNRENDERED = /\{\{[^}]*\}\}/;

function bodyText(question: Question): string {
  if (typeof question.body === "string") return question.body;
  if (question.body === null || question.body === undefined) return "";
  return JSON.stringify(question.body);
}

export function classifyQuestion(question: Question): QuestionClass {
  if (UNRENDERED.test(question.id) || UNRENDERED.test(question.title) || UNRENDERED.test(question.kind ?? "")) return "malformed";
  const empty = bodyText(question).trim() === "" || bodyText(question).trim() === "{}";
  if (empty && !(question.asks && question.asks.length > 0) && question.run?.linked !== true) return "malformed";
  if (question.kind === "notice") return "notice";
  if (answersAreUnread(answerReaderFor(question.id))) return "unread";
  return "ask";
}

/** The folded groups, in the order they follow the asks. */
export const FOLDED: readonly { cls: Exclude<QuestionClass, "ask">; label: string }[] = [
  { cls: "notice", label: "Notices" },
  { cls: "unread", label: "No reader" },
  { cls: "malformed", label: "Malformed" },
];

/** The part of a gap question's body before its truncated `Summary:` clause. */
export function bodyLead(question: Question): string {
  const body = bodyText(question);
  const at = body.indexOf("Summary:");
  return (at >= 0 ? body.slice(0, at) : body).trim();
}
