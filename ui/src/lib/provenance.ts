/**
 * Whether a run's output came from a person, by provenance only.
 *
 * Two facts, both from records the surface already reads:
 *   1. this surface delivered the run's question and holds the answer (the
 *      question card's link to the run);
 *   2. the walk used it: goal-host logs "human answered solicitation —
 *      retrying <step> with human_input context" when an answered question
 *      drives a retry.
 * An output that step produced is a person's input carried forward. Nothing is
 * decided from a shape's name. Today the second fact is a log line kept only in
 * the walk log's last 60 lines (a gap, not a contract), and nothing says which
 * shapes need a person, so no output is labelled "without a person": that
 * needs a registry declaration the surface does not hold (user rulings 10-17).
 */

import type { Question } from "../api/participation";
import type { WalkLogEntry } from "../api/types";

const USED = /human answered solicitation — retrying (\S+) with human_input context/;

/** The step a person's answer drove on this run, or null when no answered question of this run was used. */
export function personDrivenStep(
  dispatchId: string,
  walkLog: readonly WalkLogEntry[],
  questions: readonly Question[] | undefined,
): string | null {
  const answeredHere = (questions ?? []).some((q) => q.run?.linked === true && q.run.dispatchId === dispatchId && q.answered);
  if (!answeredHere) return null;
  for (const line of walkLog) {
    const m = USED.exec(typeof line === "string" ? line : JSON.stringify(line));
    if (m?.[1]) return m[1];
  }
  return null;
}

const bare = (id: string): string => id.replace(/^(activity|template|satisfier):/, "");

/** Whether this output came from the step a person's answer drove. */
export function fromAPerson(producedBy: string | null, step: string | null): boolean {
  return producedBy !== null && step !== null && bare(producedBy) === bare(step);
}
