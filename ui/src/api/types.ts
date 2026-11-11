/**
 * The wire contract for what the page reads and sends. The run model goal-host served
 * (walk state, the board, run verdicts) went with goal-host; what a run produced is read
 * as records rows, drawn generically.
 */

/** Raw provenance entry, straight off the wire. Normalize before rendering. */
export interface RawProvenance {
  readonly shape?: unknown;
  /** Slice V4: dispatch-unique pool id, the producing execution, and the ids actually bound as inputs. */
  readonly id?: unknown;
  readonly producerExecutionId?: unknown;
  readonly consumedIds?: unknown;
  readonly goalSignature?: unknown;
  readonly producedBy?: unknown;
  /** ABSENT when the impulse carried no content. Never assume a string. */
  readonly contentPreview?: unknown;
  readonly chars?: unknown;
  /** ABSENT when the impulse carried no content. Never assume a boolean. */
  readonly truncated?: unknown;
}

export interface SurfaceChange {
  readonly field: string;
  readonly from: string;
  readonly to: string;
  readonly because: string;
}

/**
 * One clause of a typed instruction the parser could not read.
 *
 * This is a RECORD, not a string, because the parser already knows more than the
 * clause text: why no rule matched, and what goal would do the thing instead.
 * It was previously typed as `string[]` and flattened with `.map(String)`, which
 * rendered every refusal as the literal text `[object Object]` — the reason and
 * the suggested goal were computed on the server and thrown away one line before
 * they reached the person who needed them.
 */
export interface UnparsedClause {
  readonly text: string;
  readonly reason: string;
  /** A goal that WOULD do this, when the parser can name one. Empty when it cannot. */
  readonly suggestedGoal: string;
}

export type DispatchOutcome =
  /** The instruction reshaped THIS SURFACE: nothing was asked and nothing written to records. */
  | {
      readonly kind: "reshaped";
      readonly changes: readonly SurfaceChange[];
      readonly unparsed: readonly UnparsedClause[];
      readonly revision: number;
    }
  /** The output on screen redrawn in another form; nothing dispatched, nothing written. */
  | { readonly kind: "view"; readonly form: string }
  /** A reading about the output on screen that could not be applied ("as a page" on prose). */
  | { readonly kind: "viewRefused"; readonly reason: string };

/** The output on screen as the surface's reader sees it. */
export interface OnScreenReport {
  readonly shape: string;
  readonly form: string;
  readonly markup: boolean;
  readonly region: string | null;
}
