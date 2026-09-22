/**
 * Records that a form was chosen, from inside the render that chose it.
 *
 * A COMPONENT RATHER THAN A CALL, for two reasons that are both about honesty
 * of the record:
 *
 *  1. It draws nothing and returns null, so recording cannot change what a
 *     person sees. A recorder that occupied layout would make the act of
 *     measuring alter the thing measured — and this surface's whole exposure
 *     model rests on the measurement being of the real page.
 *  2. The enqueue lives in an effect, so it happens AFTER commit. A decision
 *     logged during render would be logged for renders React discarded, and
 *     `decided_by` counts would then include forms nobody was ever shown.
 *
 * It also sidesteps a real hook-ordering hazard: `Entry` returns early for an
 * empty impulse, so a `useEffect` written inline in its body would be a
 * conditional hook. Keeping the effect in its own component means the callers
 * can place it wherever the plan exists, including after an early return.
 *
 * WHAT IT DOES NOT DO: judge. See the header of `lib/form-decision.ts`.
 */

import { useEffect, type ReactNode } from "react";
import { recordFormDecision } from "../lib/exposure-reporter";
import { contentSignature } from "../lib/form-decision";
import type { RenderPlan } from "../lib/ledger";

export function FormDecisionRecorder({
  shape,
  plan,
  truncated,
  policyRevision,
  region,
}: {
  shape: string;
  plan: RenderPlan;
  truncated: boolean;
  /** `renderPolicy.revision` in force at render time; null when the policy has not been read. */
  policyRevision: number | null;
  /** Where on the surface this was drawn — a question card and a ledger row are different reads. */
  region: string;
}): ReactNode {
  const signature = contentSignature(plan.text);
  useEffect(() => {
    recordFormDecision({
      shape,
      content_signature: signature,
      form: plan.form,
      decided_by: plan.decidedBy,
      policy_revision: policyRevision,
      // The DRAWN length, not the envelope's. `entry.chars` counts the wrapper,
      // and the ledger foot already had to correct for exactly this confusion.
      drawn_chars: plan.text.length,
      truncated,
      region,
    });
    // `signature` stands in for `plan.text`: a decision is identified by the
    // content it was made about, and a paint that re-derives the same plan for
    // the same bytes is not a new decision. The ledger dedupes regardless; this
    // keeps the effect from re-firing on every identical re-render in the first
    // place.
  }, [shape, signature, plan.form, plan.decidedBy, policyRevision, plan.text.length, truncated, region]);
  return null;
}
