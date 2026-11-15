/**
 * How the one box reads what a person types: by the context it shows beside it.
 *
 * A context is offered only where something reads the text. Today that is a new ask (a
 * world_changed row the walk takes up), a new ask about one already listed (the same row, citing
 * that ask and the answer drawn under it), and an open question (recorded on the question).
 * A verdict is given on an answer row, not typed. Follow-ups and corrections have no reader
 * yet, so the box never reads text as them: an ask about another starts fresh, and its chip says so.
 */

import type { Question } from "../api/participation";

export type BoxContext =
  | { readonly kind: "new" }
  | { readonly kind: "about"; readonly about: About }
  | { readonly kind: "reply"; readonly question: Question; readonly goal: string | null };

/** What an ask is about: the rows it cites (the ask, then the answer drawn under it), and that ask's words. */
export type About = { readonly cites: readonly string[]; readonly words: string };

export const NEW_ASK: BoxContext = { kind: "new" };

/** The open question, unless the person set it aside; else an ask about the one they chose; else a new ask. */
export function boxContext(question: Question | null, goal: string | null, setAside: string | null, about: About | null = null): BoxContext {
  if (question && question.id !== setAside) return { kind: "reply", question, goal: goal?.trim() || null };
  if (about) return { kind: "about", about };
  return NEW_ASK;
}

/**
 * What a new ask about a listed one cites: that ask, then each answer drawn under it that cites
 * it. A drawn row that does not cite the ask (a producer's slip) is never cited in the person's
 * name: the write says only what the person saw about this ask. Which rows were drawn is the
 * view's and the producer's; this only guards the write.
 */
export function citesOf(askId: string, drawn: readonly unknown[]): string[] {
  const out = [askId];
  for (const r of drawn) {
    if (typeof r !== "object" || r === null || Array.isArray(r)) continue;
    const row = r as Record<string, unknown>;
    if (typeof row["id"] === "string" && Array.isArray(row["input_refs"]) && row["input_refs"].map(String).includes(askId)) out.push(row["id"]);
  }
  return out;
}

/** Ask the box to read the next message as a new ask about this one (a control on a listed ask); it sends nothing. */
export function askAbout(about: About): void {
  window.dispatchEvent(new CustomEvent("sf:box-about", { detail: about }));
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
  // Not a follow-up: nothing reads one yet, so the walk takes it as a new ask that cites the old.
  if (ctx.kind === "about") return { chip: `New ask about “${ctx.about.words}” · starts fresh`, placeholder: "What do you want done?", send: "Send" };
  const about = ctx.goal ?? ctx.question.title;
  return { chip: `Answering “${about}” · waiting on you`, placeholder: "Your answer", send: "Answer" };
}

/** The echo after a message is taken: how it was read. */
export function readAs(ctx: BoxContext): string {
  if (ctx.kind === "new") return "Read as a new ask";
  if (ctx.kind === "about") return `Read as a new ask about “${ctx.about.words}”`;
  return `Read as your answer to “${ctx.goal ?? ctx.question.title}”`;
}
