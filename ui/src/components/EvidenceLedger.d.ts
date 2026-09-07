/**
 * THE EVIDENCE LEDGER — rule P8.
 *
 * The output of a walk is not "an artifact". It is the set of shaped impulses
 * the walk accumulated in the pool, mirrored onto the dispatch record
 * regardless of outcome — which is the whole point, because judging a reach
 * verdict requires seeing what was actually produced, and a failed walk's
 * outputs are exactly as worth inspecting as a reached one's.
 *
 * So every entry shows THE CONTENT ITSELF. Length, truncation, and identifiers
 * ride alongside it and appear BELOW it in source order. A character count is
 * not evidence — and a shape name, a length, and a trace id are all things this
 * surface could print without ever having looked at the output.
 *
 * ── WHY THERE IS A FALLBACK CHAIN ─────────────────────────────────────────
 *
 * Measured on a live run: a goal that genuinely reached, with a correct answer
 * in `answerBody`, arrived with `poolProvenance: []` and `poolShapes: []`. The
 * walk log said why — `REUSE-BEFORE-DERIVE — the store recommends the floor for
 * this goal (6/6 reached); running it directly and skipping the walk`. The
 * ReAct floor (`executionPath: universal_tool_fallback`) never populates the
 * pool, and the floor is a large share of all execution.
 *
 * A ledger that renders only `poolProvenance` would therefore accuse a correct
 * run of having produced nothing. That is the mirror image of the receipt
 * problem this component exists to fix: instead of a receipt where content
 * belongs, an empty state where content exists. Both are the surface lying
 * about evidence.
 *
 * Hence: pool first, then `answerBody`, then `completionShapes`, and only with
 * all three empty does the ledger say there is nothing. Each tier is LABELLED
 * with what it is, because "we have the content" and "we have the content and
 * we know which step produced it" are different claims and blurring them is
 * exactly what this surface must not do.
 */
import type { ReactNode } from "react";
import type { ExecutionPath, RawProvenance } from "../api/types";
export declare function EvidenceLedger({ formByShape, provenance, completionShapes, answerBody, goal, selectedTemplateId, executionPath, }: {
    /** `renderPolicy.formByShape`, threaded from the live query. */
    formByShape?: Readonly<Record<string, string>>;
    provenance: readonly RawProvenance[];
    completionShapes: readonly string[] | null;
    answerBody: string | null;
    goal: string | undefined;
    selectedTemplateId: string | undefined;
    executionPath: ExecutionPath | null;
}): ReactNode;
//# sourceMappingURL=EvidenceLedger.d.ts.map