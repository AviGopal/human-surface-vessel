import { useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { streamAwareInterval, useStreamConnected } from "../state/stream";
import { RENDER_POLICY_KEY, useRecheck } from "../state/recheck";
import { waitAfterMisses } from "../../../src/recheck";
import { fetchGap, fetchRenderPolicy, fetchReport, fetchUiView } from "./client";
import type { GapRecord, RenderPolicy, ReportAnswer, ReportPointer, UiViewState } from "./client";

export const queryKeys = {
  renderPolicy: RENDER_POLICY_KEY,
};

/**
 * One report the landing names, on the page's live cadence but never more often than the
 * policy's report floor: a report is a summary, not a feed, and each read costs its producer.
 *
 * A read that fails after one that answered keeps the answer drawn, marked stale with when it was
 * read and the failure's words, as a failed view read keeps the last view. A sign-in or a refusal
 * is a state, not a failure, and replaces it. Reads that keep failing wait longer each time
 * (waitAfterMisses), up to the policy's `readBackoffMaxMs`.
 */
export function useReport(pointer: ReportPointer, opts: { enabled: boolean; intervalMs: number }): UseQueryResult<ReportAnswer> {
  const recheck = useRecheck();
  const client = useQueryClient();
  const queryKey = ["report", JSON.stringify(pointer)];
  const every = Math.max(opts.intervalMs, recheck.reportMinMs);
  return useQuery({
    queryKey,
    queryFn: async () => keepLastAnswer(client.getQueryData<ReportAnswer>(queryKey), client.getQueryState(queryKey)?.dataUpdatedAt ?? 0, await fetchReport(pointer)),
    enabled: opts.enabled,
    refetchInterval: opts.enabled ? (query) => every + waitAfterMisses(missesOf(query.state.data), every, recheck.readBackoffMaxMs) : false,
    refetchOnWindowFocus: false,
  });
}

/** How many reads in a row have failed, as the answer drawn records it. */
export function missesOf(a: ReportAnswer | undefined): number {
  return !a ? 0 : a.ok ? (a.stale?.misses ?? 0) : (a.misses ?? 0);
}

/**
 * The answer to draw after a read: what came, unless it is a failure and an answer came before;
 * then that answer, stale since it was read (`readAt`, or the time it first went stale).
 */
export function keepLastAnswer(prev: ReportAnswer | undefined, readAt: number, got: ReportAnswer): ReportAnswer {
  if (got.ok || got.signIn || got.refused) return got;
  const misses = missesOf(prev) + 1;
  if (prev?.ok) return { ...prev, stale: { reason: got.reason, since: prev.stale?.since ?? readAt, misses } };
  return { ...got, misses };
}

/** A region's view, on the live cadence; a failed read keeps the last view drawn. */
export function useUiView(region: string, opts: { enabled: boolean; intervalMs: number }): UseQueryResult<UiViewState> {
  const recheck = useRecheck();
  return useQuery({
    queryKey: ["uiView", region],
    queryFn: () => fetchUiView(region),
    enabled: opts.enabled,
    refetchInterval: opts.enabled ? Math.max(opts.intervalMs, recheck.viewMinMs) : false,
    refetchOnWindowFocus: false,
    placeholderData: (previous) => previous,
    retry: false,
  });
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
  const recheck = useRecheck();
  return useQuery({
    queryKey: queryKeys.renderPolicy,
    queryFn: fetchRenderPolicy,
    enabled: opts.enabled,
    refetchInterval: opts.enabled ? streamAwareInterval(opts.intervalMs, live, recheck.streamFallbackMs) : false,
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
