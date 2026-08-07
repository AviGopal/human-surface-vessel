import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import {
  answerSolicitation,
  dispatchGoal,
  fetchActiveDispatches,
  fetchCapability,
  fetchFleetShapes,
  fetchRenderPolicy,
  fetchWalkState,
  injectContext,
  submitGrade,
} from "./client";
import type { RenderPolicy } from "./client";
import type { ActiveDispatch, GoalWalkState } from "./types";

export const queryKeys = {
  board: ["activeDispatches"] as const,
  walk: (dispatchId: string) => ["goalWalkState", dispatchId] as const,
  shapes: ["fleetShapes"] as const,
  capability: (shape: string) => ["vesselCapability", shape] as const,
  renderPolicy: ["renderPolicy"] as const,
};

/**
 * The board.
 *
 * `enabled` is how rule P6's freeze is implemented, and the choice matters:
 * with `enabled: false` TanStack Query stops refetching but KEEPS the cached
 * data, so a frozen region shows the last state it had rather than blanking.
 * Unmounting the query, or clearing it, would discard state the reader is in
 * the middle of reading — which is the same failure as moving the row.
 */
export function useBoard(opts: { enabled: boolean; intervalMs: number }): UseQueryResult<readonly ActiveDispatch[]> {
  return useQuery({
    queryKey: queryKeys.board,
    queryFn: fetchActiveDispatches,
    enabled: opts.enabled,
    refetchInterval: opts.enabled ? opts.intervalMs : false,
    refetchOnWindowFocus: false,
    staleTime: 0,
    // A poll that fails once must not blank a board the reader is using.
    placeholderData: (previous) => previous,
  });
}

export function useWalk(
  dispatchId: string | null,
  opts: { enabled: boolean; intervalMs: number },
): UseQueryResult<GoalWalkState> {
  return useQuery({
    queryKey: queryKeys.walk(dispatchId ?? ""),
    queryFn: () => fetchWalkState(dispatchId as string),
    enabled: Boolean(dispatchId) && opts.enabled,
    refetchInterval: opts.enabled ? opts.intervalMs : false,
    refetchOnWindowFocus: false,
    placeholderData: (previous) => previous,
  });
}

/**
 * The live shape vocabulary. Long stale time: the fleet's vocabulary changes on
 * the order of deployments, not seconds, and re-deriving starters underneath a
 * reader who is about to click one would move the target.
 */
export function useFleetShapes(): UseQueryResult<readonly string[]> {
  return useQuery({
    queryKey: queryKeys.shapes,
    queryFn: fetchFleetShapes,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });
}

/** Producer verification for ONE starter. Refines a chip already on screen. */
export function useCapability(shape: string, enabled: boolean): UseQueryResult<boolean> {
  return useQuery({
    queryKey: queryKeys.capability(shape),
    queryFn: () => fetchCapability(shape),
    enabled,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  });
}

export function useDispatchGoal() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: dispatchGoal,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.board });
    },
  });
}

export function useSubmitGrade() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: submitGrade,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.board });
    },
  });
}

export function useAnswerSolicitation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: answerSolicitation,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.board });
    },
  });
}

export function useInjectContext() {
  return useMutation({ mutationFn: injectContext });
}


/**
 * Rendering behaviour, re-read on the live cadence. Freezes with everything
 * else when the reader pauses — a policy change must not move the surface under
 * someone who has deliberately stopped it.
 */
export function useRenderPolicy(opts: {
  enabled: boolean;
  intervalMs: number;
}): UseQueryResult<RenderPolicy> {
  return useQuery({
    queryKey: queryKeys.renderPolicy,
    queryFn: fetchRenderPolicy,
    enabled: opts.enabled,
    refetchInterval: opts.enabled ? opts.intervalMs : false,
    refetchOnWindowFocus: false,
    staleTime: 0,
    placeholderData: (previous) => previous,
  });
}
