/**
 * How the one box reads what a person types: by the context it shows beside it.
 *
 * A context is offered only where something reads the text. Today that is a new
 * ask (goal-host's dispatch) and a run's open question (its pending solicitation,
 * read by the waiting walk). Follow-ups, corrections and verdicts have no reader
 * yet, so the box never offers them.
 */

import type { Question } from "../api/participation";

export type BoxContext =
  | { readonly kind: "new" }
  | { readonly kind: "reply"; readonly question: Question; readonly goal: string | null };

export const NEW_ASK: BoxContext = { kind: "new" };

/** The open question of the run on screen, unless the person set it aside. */
export function boxContext(question: Question | null, goal: string | null, setAside: string | null): BoxContext {
  if (!question || question.id === setAside) return NEW_ASK;
  return { kind: "reply", question, goal: goal?.trim() || null };
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
  return ctx.kind === "new" ? "Read as a new ask" : `Read as your answer to “${ctx.goal ?? ctx.question.title}”`;
}

/** Who a presentation change applies to, from the field it changed. */
export function presentationScope(field: string): string {
  const shape = /^formByShape\.(.+)$/.exec(field)?.[1];
  return shape ? `every ${shape} output` : "the whole surface";
}
