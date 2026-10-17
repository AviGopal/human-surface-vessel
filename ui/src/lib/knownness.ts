/**
 * How much the run itself says it knows about its outcome, read only from the
 * fields it reports. Never inferred from wording or from how good it looks.
 *
 *   verified        a deterministic reach check passed (e.g. the expected value
 *                   was found in what was stored, or a landing was confirmed in git)
 *   learned         the run took a recorded pathway
 *   not-understood  inference returned no target, so the walk ran blind
 *   unknown         everything else; never drawn as verified
 */
import type { GoalWalkState } from "../api/types";

export type Knownness = "verified" | "learned" | "not-understood" | "unknown";

const VERIFIED = /^deterministic:(transform-verified|early-edit-intent-landed)\b/;
const EMPTY_INFERENCE = /goal-target inference \{[^}]*"inferred_target_shapes":\[\]/;

export function knownness(walk: Pick<GoalWalkState, "reached" | "goalReachReason" | "executionPath" | "walkLog">): Knownness {
  const log = (walk.walkLog ?? []).map((l) => (typeof l === "string" ? l : JSON.stringify(l)));
  if (log.some((l) => EMPTY_INFERENCE.test(l))) return "not-understood";
  if (walk.reached === true && VERIFIED.test(walk.goalReachReason ?? "")) return "verified";
  if (walk.reached === true && walk.executionPath === "learned_pathway") return "learned";
  return "unknown";
}

export const KNOWNNESS_LABEL: Readonly<Record<Knownness, string | null>> = {
  verified: "verified by a check",
  learned: "learned path",
  "not-understood": "not understood",
  unknown: null,
};
