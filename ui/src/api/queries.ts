import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { streamAwareInterval, useStreamConnected } from "../state/stream";
import { fetchGap, fetchRenderPolicy, fetchReport, fetchUiView } from "./client";
import type { GapRecord, RenderPolicy, ReportAnswer, ReportPointer, UiViewState } from "./client";

export const queryKeys = {
  renderPolicy: ["renderPolicy"] as const,
};

/**
 * One report the landing names, on the page's live cadence (the render policy's) but never
 * more often than once a minute: a report is a summary, not a feed, and each read costs its producer.
 */
export function useReport(pointer: ReportPointer, opts: { enabled: boolean; intervalMs: number }): UseQueryResult<ReportAnswer> {
  return useQuery({
    queryKey: ["report", JSON.stringify(pointer)],
    queryFn: () => fetchReport(pointer),
    enabled: opts.enabled,
    refetchInterval: opts.enabled ? Math.max(opts.intervalMs, 60_000) : false,
    refetchOnWindowFocus: false,
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
