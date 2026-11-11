/**
 * How often the page looks again, as the render policy says (src/recheck.ts). Read from the
 * policy the page already polls; until it has arrived, each value is its bootstrap default.
 */
import { useQuery } from "@tanstack/react-query";
import { fetchRenderPolicy } from "../api/client";
import { recheckOf, type Recheck } from "../../../src/recheck";

export const RENDER_POLICY_KEY = ["renderPolicy"] as const;

/** The recheck in force. Reads the cached policy only; the page's policy query does the polling. */
export function useRecheck(): Recheck {
  const policy = useQuery({ queryKey: RENDER_POLICY_KEY, queryFn: fetchRenderPolicy, enabled: false });
  return recheckOf(policy.data?.recheck);
}
