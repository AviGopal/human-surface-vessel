/**
 * The wire contract, typed against what goal-host ACTUALLY serializes.
 *
 * The important thing in this file is what is OPTIONAL. goal-host's
 * goalWalkState serializer null-coalesces most fields but NOT all of them:
 * `goal`, `executionId`, `selectedTemplateId`, and `error` are written through
 * bare, so `JSON.stringify` drops the key entirely when the value is
 * undefined. Typing those as `string | null` would compile and then lie at
 * runtime — `state.executionId` is `undefined`, not `null`, and every
 * `=== null` guard written against it silently fails open.
 *
 * Same defect, worse consequences, in `poolProvenance`: the empty-content
 * branch omits `contentPreview` and `truncated` rather than emitting `false`.
 * That union is not represented here as an optional field — it is normalized
 * into a discriminated union in `lib/ledger.ts` before any component sees it.
 */

export type DispatchStatus = "running" | "completed" | "failed";

/**
 * What KIND of run this was. Use this, never `walkTier` — `walkTier` is a
 * legacy field that has been stripped and re-added and does not reliably
 * describe the path taken.
 */
export type ExecutionPath =
  | "learned_pathway"
  | "satisfier"
  | "universal_tool_fallback"
  | "feature_compose"
  | "fresh_derivation";

export const EXECUTION_PATH_PROSE: Readonly<Record<ExecutionPath, string>> = {
  learned_pathway: "ran a pathway it had learned before",
  satisfier: "was satisfied directly, without a full walk",
  universal_tool_fallback: "fell back to the general tool loop",
  feature_compose: "went through the code-editing composer",
  fresh_derivation: "derived a new path from the shape graph",
};

/** A walk log line. The wire has carried both strings and objects here. */
export type WalkLogEntry = string | Record<string, unknown>;

export interface WalkStep {
  readonly shape?: string;
  readonly templateId?: string;
  readonly status?: string;
  readonly [k: string]: unknown;
}

export interface PoolEvent {
  readonly shape?: string;
  readonly source?: string;
  readonly at?: number;
}

export interface LearningConsequences {
  readonly [k: string]: unknown;
}

/** Raw provenance entry, straight off the wire. Normalize before rendering. */
export interface RawProvenance {
  readonly shape?: unknown;
  readonly goalSignature?: unknown;
  readonly producedBy?: unknown;
  /** ABSENT when the impulse carried no content. Never assume a string. */
  readonly contentPreview?: unknown;
  readonly chars?: unknown;
  /** ABSENT when the impulse carried no content. Never assume a boolean. */
  readonly truncated?: unknown;
}

export interface GoalWalkState {
  readonly dispatchId: string;
  readonly status: DispatchStatus;
  readonly reached: boolean | null;
  readonly goalReachReason: string | null;
  readonly poolShapes: readonly string[];
  readonly poolProvenance: readonly RawProvenance[];
  readonly pendingTargets: readonly string[];
  readonly poolEvents: readonly PoolEvent[];
  readonly walkLog: readonly WalkLogEntry[];
  readonly currentStep: WalkLogEntry | null;
  readonly steps: readonly WalkStep[];
  readonly executionPath: ExecutionPath | null;
  readonly walkTier: string | null;
  readonly attemptCount: number | null;
  readonly grounded: boolean | null;
  readonly learning: LearningConsequences | null;
  readonly answerBody: string | null;
  readonly operator: string | null;
  readonly completionShapes: readonly string[] | null;
  readonly humanGraded: boolean;
  readonly humanReachNotes: string | null;
  readonly trigger: string | null;
  readonly requeueOf: string | null;

  /* ── serialized without a null coalesce: the KEY IS ABSENT ─────────────── */
  readonly goal?: string;
  readonly executionId?: string;
  readonly selectedTemplateId?: string;
  readonly error?: string;
}

/** A row on the board. `activeDispatches` is capped at 50 and pre-sorted. */
export interface ActiveDispatch {
  readonly dispatchId: string;
  /** Sliced to 200 characters upstream, and null when the goal text was lost. */
  readonly goal: string | null;
  readonly status: DispatchStatus;
  readonly reached: boolean | null;
  readonly operator: string | null;
  readonly trigger: string | null;
  /** Has arrived as both an ISO string and an epoch number. Parse defensively. */
  readonly startedAt: string | number | null;
  readonly learning: LearningConsequences | null;
  readonly answerBody: string | null;
  readonly selectedTemplateId?: string;
  readonly executionId?: string;
}

/**
 * The four distinct outcomes of a dispatch.
 *
 * `refused` arrives as **200, not 202**, and is terminal — nothing ran. A poll
 * loop keyed on "did I get a 202" treats it as a live run and waits forever on
 * a dispatch that will never emit. Branch on the discriminant, never on the
 * HTTP status.
 */
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
  /**
   * The instruction reshaped THIS SURFACE rather than dispatching a walk.
   * It is a distinct outcome and not a kind of "accepted": nothing was
   * dispatched, there is no dispatchId, and no run will appear on the board.
   * Collapsing it into acceptance would be the same class of lie as reporting
   * a status where a verdict belongs.
   */
  | {
      readonly kind: "reshaped";
      readonly changes: readonly SurfaceChange[];
      readonly unparsed: readonly UnparsedClause[];
      readonly revision: number;
    }
  | { readonly kind: "accepted"; readonly dispatchId: string; readonly coalesced: boolean }
  | { readonly kind: "refused"; readonly dispatchId: string; readonly reason: string | null }
  | { readonly kind: "draining"; readonly message: string }
  | { readonly kind: "rejected"; readonly message: string; readonly httpStatus: number };

export interface DispatchRequest {
  readonly goal: string;
  readonly operator?: string;
  readonly variables?: Record<string, unknown>;
  readonly tags?: readonly string[];
  readonly expected_output_shapes?: readonly string[];
}

/** A human verdict, as the oracle corpus stores it. */
export type OracleVerdict = "achieved" | "not_achieved" | "partial";

export interface GradeSubmission {
  readonly executionId: string;
  readonly goal: string;
  readonly verdict: OracleVerdict;
  /** The verdict option, verbatim. The corpus keeps the granularity. */
  readonly notes: string;
}

export type SolicitationOutcome = "answered" | "declined" | "insufficient_context";
