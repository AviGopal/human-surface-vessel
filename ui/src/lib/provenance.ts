/**
 * Whether a run's input under a person-resolved shape came from a person.
 *
 * Decided by provenance, never by the shape's name: input is a person's only
 * when this surface delivered the run's question and holds the answer. Input
 * under the same shape produced any other way is a stand-in. A stand-in is not
 * hidden or failed; it is labelled, and its use and grades decide (user rulings
 * 10-17).
 */

import type { Question } from "../api/participation";

export type PersonProvenance = "from-a-person" | "without-a-person";

export function personProvenance(
  shape: string,
  personShapes: readonly string[],
  questions: readonly Question[] | undefined,
  dispatchId: string,
): PersonProvenance | null {
  if (!personShapes.includes(shape)) return null;
  const answered = (questions ?? []).some((q) => q.run?.linked === true && q.run.dispatchId === dispatchId && q.answered);
  return answered ? "from-a-person" : "without-a-person";
}

export const PROVENANCE_LABEL: Readonly<Record<PersonProvenance, string>> = {
  "from-a-person": "your answer",
  "without-a-person": "no person asked",
};
