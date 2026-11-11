/**
 * How much the page draws, as the render policy says (src/limits.ts). Read from the policy the
 * page already polls; until it has arrived, each value is its bootstrap default.
 */
import { useQuery } from "@tanstack/react-query";
import { fetchRenderPolicy } from "../api/client";
import { LIMITS, type Limits } from "../../../src/limits";
import { RENDER_POLICY_KEY } from "./recheck";

/** The limits in force. Reads the cached policy only; the page's policy query does the polling. */
export function useLimits(): Limits {
  const policy = useQuery({ queryKey: RENDER_POLICY_KEY, queryFn: fetchRenderPolicy, enabled: false });
  return LIMITS.of(policy.data?.limits);
}
