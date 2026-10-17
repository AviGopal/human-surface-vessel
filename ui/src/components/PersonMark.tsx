/** The provenance mark on a person-resolved output: "your answer" or "no person asked". */

import type { ReactNode } from "react";
import { usePersonShapes } from "../api/queries";
import { PROVENANCE_LABEL, personProvenance } from "../lib/provenance";
import { useQuestionsIfAny } from "../state/questions";

export function usePersonProvenance(shape: string | null, dispatchId: string | null) {
  const shapes = usePersonShapes();
  const questions = useQuestionsIfAny()?.query.data?.questions;
  return shape && dispatchId ? personProvenance(shape, shapes, questions, dispatchId) : null;
}

export function PersonMark({ shape, dispatchId }: { shape: string | null; dispatchId: string | null }): ReactNode {
  const p = usePersonProvenance(shape, dispatchId);
  if (!p) return null;
  return (
    <span
      className="sf-person-mark"
      data-provenance={p}
      title={p === "without-a-person" ? "Produced under a person's shape, but this run's question was never delivered and answered here." : "From the answer given to this run's question."}
    >
      {PROVENANCE_LABEL[p]}
    </span>
  );
}
