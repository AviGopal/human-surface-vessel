import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { streamAwareInterval, useStreamConnected } from "../state/stream";
import {
  dispatchGoal,
  fetchActiveDispatches,
  fetchCapability,
  fetchFleetShapes,
  fetchGap,
  fetchGapThreads,
  fetchRenderPolicy,
  fetchUiView,
  fetchVerdicts,
  fetchWalkState,
  injectContext,
  submitGrade,
} from "./client";
import type { GapRecord, RenderPolicy, UiViewState } from "./client";
import type { ActiveDispatch, GoalWalkState } from "./types";

export const queryKeys = {
  board: ["activeDispatches"] as const,
  walk: (dispatchId: string) => ["goalWalkState", dispatchId] as const,
  shapes: ["fleetShapes"] as const,
  capability: (shape: string) => ["vesselCapability", shape] as const,
  renderPolicy: ["renderPolicy"] as const,
  verdicts: (dispatchId: string) => ["verdicts", dispatchId] as const,
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
    // NO RETRY, and this is about honesty rather than about load.
    //
    // A retrying query re-enters `pending` on the way to each attempt, so
    // `isError` FLAPS: on a 2s poll against a dead upstream the region spent
    // roughly one second in three rendering "Reading the board…" over the top
    // of its own failure banner — a surface whose entire premise is that it
    // cannot report a status as an outcome, hiding its outage on a loop.
    // With retry off, a failed poll is a failed poll until the next one, and
    // the region reads `failureCount` rather than `isError` so even a
    // momentary return to `pending` cannot repaint the failure as loading.
    retry: false,
  });
}

/** How often a FINISHED run is re-read. */
export const FINISHED_WALK_REFETCH_MS = 60_000;

/**
 * The poll interval for one run's walk state, or false for none.
 *
 * A running walk is read on the live cadence. A finished one (completed or
 * failed) still changes rarely (a verdict recorded, a late judgement), so it is
 * re-read slowly rather than never. Measured 10-14: one tab holding a finished
 * run polled it every ~2 s for hours, and goal-host re-reads that run's labels
 * on every poll, about 28 sorted DB reads a minute on a saturated host. A status
 * this does not know keeps the live cadence.
 */
export function walkRefetchMs(data: Pick<GoalWalkState, "status"> | undefined, enabled: boolean, intervalMs: number): number | false {
  if (!enabled) return false;
  const status = data?.status;
  return status === "completed" || status === "failed" ? Math.max(intervalMs, FINISHED_WALK_REFETCH_MS) : intervalMs;
}

export function useWalk(
  dispatchId: string | null,
  opts: { enabled: boolean; intervalMs: number },
): UseQueryResult<GoalWalkState> {
  return useQuery({
    queryKey: queryKeys.walk(dispatchId ?? ""),
    queryFn: () => fetchWalkState(dispatchId as string),
    enabled: Boolean(dispatchId) && opts.enabled,
    // Hidden tabs already stop: react-query's refetchIntervalInBackground defaults to false.
    refetchInterval: (query) => walkRefetchMs(query.state.data, opts.enabled, opts.intervalMs),
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

/** A region's view, on the live cadence; a failed read keeps the last view drawn. */
export function useUiView(region: string, opts: { enabled: boolean; intervalMs: number }): UseQueryResult<UiViewState> {
  return useQuery({
    queryKey: ["uiView", region],
    queryFn: () => fetchUiView(region),
    enabled: opts.enabled,
    refetchInterval: opts.enabled ? Math.max(opts.intervalMs, 5000) : false,
    refetchOnWindowFocus: false,
    placeholderData: (previous) => previous,
    retry: false,
  });
}

/** This node's gap threads; the server joins them once a minute, so they are read at that pace. */
export function useGapThreads(opts: { enabled: boolean }) {
  return useQuery({ queryKey: ["gapThreads"], queryFn: fetchGapThreads, enabled: opts.enabled, refetchInterval: opts.enabled ? 60_000 : false });
}

/** Verdicts kept on a run. Read once and after each grade, not polled. */
export function useVerdicts(dispatchId: string | null) {
  return useQuery({
    queryKey: queryKeys.verdicts(dispatchId ?? ""),
    queryFn: () => fetchVerdicts(dispatchId ?? ""),
    enabled: dispatchId !== null,
    staleTime: Infinity,
  });
}

/** The newest verdicts across runs, for the rail's marks; on the board's cadence. */
export function useAllVerdicts(opts: { enabled: boolean; intervalMs: number }) {
  return useQuery({
    queryKey: ["verdicts", "*"],
    queryFn: () => fetchVerdicts(),
    enabled: opts.enabled,
    refetchInterval: opts.enabled ? opts.intervalMs * 5 : false,
  });
}

export function useSubmitGrade() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: submitGrade,
    // The surface keeps the verdict before the corpus answers, so re-read it either way.
    onSettled: (_d, _e, g) => {
      if (g.dispatchId) void client.invalidateQueries({ queryKey: queryKeys.verdicts(g.dispatchId) });
      void client.invalidateQueries({ queryKey: ["verdicts", "*"] });
    },
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
  const live = useStreamConnected();
  return useQuery({
    queryKey: queryKeys.renderPolicy,
    queryFn: fetchRenderPolicy,
    enabled: opts.enabled,
    refetchInterval: opts.enabled ? streamAwareInterval(opts.intervalMs, live) : false,
    refetchOnWindowFocus: false,
    staleTime: 0,
    placeholderData: (previous) => previous,
  });
}

/**
 * One gap, polled while a question card that escalated it is open, so the card
 * can show what became of the answer. `intervalMs: false` reads once.
 */
export function useGap(id: string | null, opts: { enabled: boolean; intervalMs: number | false }): UseQueryResult<GapRecord | null> {
  return useQuery({
    queryKey: ["gap", id],
    queryFn: () => fetchGap(id as string),
    enabled: opts.enabled && id !== null,
    refetchInterval: opts.enabled ? opts.intervalMs : false,
    refetchOnWindowFocus: false,
    retry: 1,
  });
}
