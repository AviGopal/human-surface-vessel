/**
 * INTERACTION — every place the surface asks a person for input, typed the
 * same way a decision model is asked.
 *
 * The question kinds are TypeSafe/Jev's primitives (Choice, Score, Noul) plus
 * free text, so a human and a model are interchangeable answerers of one typed
 * question. A human answer is expressed in the model's answer shape: a choice
 * made by a person is probability 1 on that option, with NO `confidence` — the
 * field is present only when an answerer actually supplies one, and a `noul`
 * never carries it at all.
 *
 * The payload builders below are the ONLY place each write's body is composed,
 * so the widgets can change without the write changing. Their output is pinned
 * byte-for-byte by test/interaction.test.ts.
 */

import type { OracleVerdict } from "../api/types";

export type Question =
  | { readonly kind: "choice"; readonly options: readonly string[] }
  | { readonly kind: "score"; readonly levels: readonly string[]; readonly legend?: string }
  | { readonly kind: "noul"; readonly statement: string }
  | { readonly kind: "number" }
  | { readonly kind: "text"; readonly formats?: readonly ("text" | "json")[] };

export type Answer =
  | { readonly type: "choice"; readonly choice: string; readonly probabilities: Readonly<Record<string, number>> }
  | { readonly type: "score"; readonly score: string; readonly probabilities: Readonly<Record<string, number>> }
  | { readonly type: "noul"; readonly noul: number }
  | { readonly type: "number"; readonly number: number }
  | { readonly type: "text"; readonly text: string };

export type InteractionState = "idle" | "pending" | "sent" | "failed";

/** A person's pick, in the model's answer shape. */
export function humanChoice(choice: string): Answer {
  return { type: "choice", choice, probabilities: { [choice]: 1 } };
}

/** The server's ask types, mapped onto the question kinds. Unknown → text. */
export function questionForAsk(ask: { type: string; choices?: readonly string[] }): Question {
  if (ask.type === "choice" && ask.choices && ask.choices.length > 0) return { kind: "choice", options: ask.choices };
  if (ask.type === "number") return { kind: "number" };
  return { kind: "text" };
}

/* ───────────────────────── payload builders (pinned) ───────────────────────── */

/** Grading a finished run → `goal_verification_label_write` via /api/grade. */
export function gradePayload(args: {
  renderedState: "reached" | "not-reached";
  option: string;
  note: string;
  executionId: string;
  goal: string;
}): { executionId: string; goal: string; verdict: OracleVerdict; notes: string } {
  const verdict: OracleVerdict =
    args.renderedState === "reached" ? "not_achieved" : args.option === "It actually worked" ? "achieved" : "not_achieved";
  return {
    executionId: args.executionId,
    goal: args.goal,
    verdict,
    notes: args.note.trim() ? `${args.option} — ${args.note.trim()}` : args.option,
  };
}

/** Pushing context into a running walk → `poolImpulse_write`. */
export function injectPayload(args: { dispatchId: string; shape: string; content: string }): {
  dispatchId: string;
  shape: string;
  content: string;
} {
  return { dispatchId: args.dispatchId, shape: args.shape.trim(), content: args.content.trim() };
}

export type ComplaintKind = "hard_to_see" | "hard_to_understand" | "wrong";

/** Reporting a problem with the interface → `uiFeedback` via /api/feedback. */
export function complaintPayload(args: { region: string; kind: ComplaintKind; text: string }): {
  panel_id: string;
  kind: ComplaintKind;
  value: string;
} {
  return { panel_id: args.region, kind: args.kind, value: args.text.trim() };
}

/**
 * A response to a system question. `value` is the answer as the store keeps it
 * (text, parsed JSON, a chosen option, a number); `typed` never rides the wire
 * until the store accepts typed answers.
 */
export function contributionContent(args: {
  panelId: string;
  revision: number;
  askId: string | null;
  kind: "answer" | "dismiss";
  value: unknown;
}): { panel_id: string; panel_revision: number; ask_id?: string; kind: "answer" | "dismiss"; value: unknown } {
  return {
    panel_id: args.panelId,
    panel_revision: args.revision,
    ...(args.kind === "answer" && args.askId ? { ask_id: args.askId } : {}),
    kind: args.kind,
    value: args.value,
  };
}
