/**
 * How the one box reads what a person types: by the context it shows beside it.
 *
 * A context is offered only where something reads the text. Today that is a new ask (a
 * world_changed row the walk takes up) and an open question (recorded on the question).
 * A verdict is given on an answer row, not typed. Follow-ups and corrections have no reader
 * yet, so the box never reads text as them.
 */

import type { Question } from "../api/participation";

export type BoxContext =
  | { readonly kind: "new" }
  | { readonly kind: "reply"; readonly question: Question; readonly goal: string | null };

export const NEW_ASK: BoxContext = { kind: "new" };

/** The open question, unless the person set it aside; else a new ask. */
export function boxContext(question: Question | null, goal: string | null, setAside: string | null): BoxContext {
  if (question && question.id !== setAside) return { kind: "reply", question, goal: goal?.trim() || null };
  return NEW_ASK;
}

/**
 * A reply to a waiting run read from one of the two exact phrases the box offers
 * beside it: "not now" declines, "need more" asks for more. Anything else is an
 * answer, including words like "skip" or "decline" that answer some questions.
 * The set is closed on purpose; the walk's own reading of a reply is where any
 * wider understanding belongs (the D1 gap).
 */
export const REPLY_PHRASES = { "not now": "declined", "need more": "insufficient_context" } as const;

export function readReplyPhrase(text: string): { outcome: "declined" | "insufficient_context"; phrase: string } | null {
  const t = text.trim().toLowerCase().replace(/[.!\s]+$/u, "").replace(/\s+/g, " ");
  const outcome = (REPLY_PHRASES as Record<string, "declined" | "insufficient_context">)[t];
  return outcome ? { outcome, phrase: t } : null;
}

/**
 * A complaint about the interface, read from three exact prefixes at the START
 * of a message (the complaint kinds the form offered), with something after the
 * colon. A prefix anywhere else, or none, is not a complaint.
 */
export const COMPLAINT_PREFIXES = { "hard to see": "hard_to_see", "hard to understand": "hard_to_understand", wrong: "wrong" } as const;
export type ComplaintPrefixKind = (typeof COMPLAINT_PREFIXES)[keyof typeof COMPLAINT_PREFIXES];

export function readComplaint(text: string): { kind: ComplaintPrefixKind; text: string } | null {
  const m = /^\s*(hard to see|hard to understand|wrong)\s*:\s*([\s\S]*\S)\s*$/i.exec(text);
  if (!m || m[1] === undefined || m[2] === undefined) return null;
  return { kind: COMPLAINT_PREFIXES[m[1].toLowerCase() as keyof typeof COMPLAINT_PREFIXES], text: m[2] };
}

/**
 * A complaint's prefix with nothing after it ("hard to understand:", as a chip leaves
 * it). It is not a complaint and not an ask: it stays in the box until it says
 * something. The prefix, lower-cased, or null.
 */
export function barePrefix(text: string): string | null {
  const m = /^\s*(hard to see|hard to understand|wrong)\s*:\s*$/i.exec(text);
  return m?.[1] ? m[1].toLowerCase() : null;
}

/** Ask the one box to take this text (a chip elsewhere on the page); it fills, never sends. */
export function fillBox(text: string): void {
  window.dispatchEvent(new CustomEvent("sf:fill-box", { detail: text }));
}

export interface BoxWords {
  /** What the chip beside the box says the next message will be. */
  readonly chip: string;
  readonly placeholder: string;
  readonly send: string;
}

export function boxWords(ctx: BoxContext): BoxWords {
  if (ctx.kind === "new") return { chip: "New ask", placeholder: "What do you want done?", send: "Send" };
  const about = ctx.goal ?? ctx.question.title;
  return { chip: `Answering “${about}” · waiting on you`, placeholder: "Your answer", send: "Answer" };
}

/** The echo after a message is taken: how it was read. */
export function readAs(ctx: BoxContext): string {
  if (ctx.kind === "new") return "Read as a new ask";
  return `Read as your answer to “${ctx.goal ?? ctx.question.title}”`;
}

/** Who a presentation change applies to, from the field it changed. */
export function presentationScope(field: string): string {
  const shape = /^formByShape\.(.+)$/.exec(field)?.[1];
  return shape ? `every ${shape} output` : "the whole surface";
}
