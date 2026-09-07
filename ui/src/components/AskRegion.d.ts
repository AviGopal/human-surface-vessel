/**
 * ASK — one box, and what happens the moment you use it.
 *
 * A human sends goals in natural language. This surface does not ask anyone to
 * pre-decompose a request, name a target shape, or speak the system's internal
 * vocabulary: if a goal only works after somebody rewrites it with file paths
 * and expected shapes, that rewriting is a gap in the system, not a workflow to
 * institutionalise here.
 *
 * The run contract appears ON SUBMIT, not before — it describes the walk that
 * was just accepted, and it carries a duration BAND rather than an estimate and
 * no confidence number at all.
 */
import { type ReactNode } from "react";
export declare function AskRegion({ onDispatched }: {
    onDispatched: (dispatchId: string) => void;
}): ReactNode;
//# sourceMappingURL=AskRegion.d.ts.map