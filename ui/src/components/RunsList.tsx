/**
 * The runs rail.
 *
 *  P3 — arrivals that would land above the reader's viewport, or while they are
 *       interacting, are buffered behind a count they accept, never spliced in.
 *  P5 — a run's sort key is pinned at first observation, so an existing row
 *       never moves; only insertions can disturb the layout, and P3 governs those.
 *  P4 — rows are keyed on dispatch id, and the roving tab stop is held as an id.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { useBoard } from "../api/queries";
import type { ActiveDispatch } from "../api/types";
import { sortRuns } from "../lib/sort";
import { parseStartedAt } from "../lib/time";
import { useNow } from "../lib/useNow";
import { useLiveControls, useRegionFreeze } from "../state/liveControls";
import { RunRow } from "./RunRow";

/** How many in-flight rows may hold their own walk query. */
const LIVE_DETAIL_BUDGET = 6;

export type RunFilter = "all" | "mine" | "system";

/** Runs asked from this surface. Everything else was started by the system. */
export function isMine(row: ActiveDispatch): boolean {
  return row.operator === "human-surface";
}

interface Positioned {
  readonly row: ActiveDispatch;
  readonly dispatchId: string;
  readonly startedAtMs: number;
}

function position(rows: readonly ActiveDispatch[], fallback: number): readonly Positioned[] {
  return rows.map((row) => ({ row, dispatchId: row.dispatchId, startedAtMs: parseStartedAt(row.startedAt, fallback) }));
}

export function RunsList({
  selectedDispatchId,
  onSelect,
  filter,
}: {
  selectedDispatchId: string | null;
  onSelect: (dispatchId: string) => void;
  filter: RunFilter;
}): ReactNode {
  const { paused, intervalMs } = useLiveControls();
  const { frozen, handlers } = useRegionFreeze();
  const now = useNow(paused);
  const board = useBoard({ enabled: !paused && !frozen, intervalMs });

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [committed, setCommitted] = useState<readonly Positioned[]>([]);
  const [buffered, setBuffered] = useState<readonly Positioned[]>([]);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const knownRef = useRef<Set<string>>(new Set());
  const data = board.data;

  useEffect(() => {
    if (!data) return;
    const incoming = position(data, Date.now());
    const incomingById = new Map(incoming.map((p) => [p.dispatchId, p]));
    const atTop = (scrollRef.current?.scrollTop ?? 0) <= 0;
    const acceptsArrivals = atTop && !frozen && !paused;
    const arrivals = incoming.filter((p) => !knownRef.current.has(p.dispatchId));

    setCommitted((prev) => {
      // Refresh data in place but keep the sort key from first observation: a
      // null startedAt gets a Date.now() fallback that would otherwise restamp
      // on every poll and walk the row around the board.
      const refreshed = prev
        .map((p) => {
          const next = incomingById.get(p.dispatchId);
          return next ? { ...next, startedAtMs: p.startedAtMs } : p;
        })
        .filter((p) => incomingById.has(p.dispatchId) || p.dispatchId === selectedDispatchId || frozen || !atTop);
      return acceptsArrivals && arrivals.length > 0 ? sortRuns([...refreshed, ...arrivals]) : sortRuns(refreshed);
    });

    if (!acceptsArrivals && arrivals.length > 0) {
      setBuffered((prev) => {
        const seen = new Set(prev.map((p) => p.dispatchId));
        const fresh = arrivals.filter((p) => !seen.has(p.dispatchId));
        return fresh.length === 0 ? prev : sortRuns([...prev, ...fresh]);
      });
    }
    for (const p of arrivals) knownRef.current.add(p.dispatchId);
  }, [data, frozen, paused, selectedDispatchId]);

  const acceptBuffered = useCallback(() => {
    setCommitted((prev) => {
      const known = new Set(prev.map((p) => p.dispatchId));
      return sortRuns([...prev, ...buffered.filter((p) => !known.has(p.dispatchId))]);
    });
    setBuffered([]);
    scrollRef.current?.scrollTo({ top: 0 });
  }, [buffered]);

  const shown = committed.filter((p) => (filter === "all" ? true : filter === "mine" ? isMine(p.row) : !isMine(p.row)));
  const bufferedShown = buffered.filter((p) => (filter === "all" ? true : filter === "mine" ? isMine(p.row) : !isMine(p.row)));

  const onListKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) || shown.length === 0) return;
      const at = shown.findIndex((p) => p.dispatchId === (focusedId ?? shown[0]?.dispatchId));
      const from = at === -1 ? 0 : at;
      let next = from;
      if (event.key === "ArrowDown") next = Math.min(from + 1, shown.length - 1);
      if (event.key === "ArrowUp") next = Math.max(from - 1, 0);
      if (event.key === "Home") next = 0;
      if (event.key === "End") next = shown.length - 1;
      const target = shown[next];
      if (!target) return;
      event.preventDefault();
      setFocusedId(target.dispatchId);
      const el = scrollRef.current?.querySelector<HTMLElement>(`[data-dispatch-id="${CSS.escape(target.dispatchId)}"]`);
      el?.focus();
      el?.scrollIntoView({ block: "nearest" });
    },
    [shown, focusedId],
  );

  // The membership test keeps the list enterable when the focused run has left the board.
  const rovingId = shown.some((p) => p.dispatchId === focusedId) ? focusedId : (shown[0]?.dispatchId ?? null);
  // Held until a poll succeeds: `isError` alone flaps while a retry is pending.
  const failed = board.isError || board.failureCount > 0;

  const live = new Set<string>();
  for (const p of shown) {
    if (p.row.status === "running" && live.size < LIVE_DETAIL_BUDGET) live.add(p.dispatchId);
  }

  return (
    <div className="sf-rail-viewport" {...handlers}>
      {bufferedShown.length > 0 ? (
        <button type="button" className="sf-new-pill" onClick={acceptBuffered}>
          ↑ {bufferedShown.length} new
        </button>
      ) : null}
      <div
        className="sf-rail-scroll"
        ref={scrollRef}
        role="log"
        aria-live="polite"
        aria-relevant="additions text"
        aria-busy={board.isFetching}
        aria-label="Runs, newest first"
        onKeyDown={onListKeyDown}
      >
        {failed && committed.length === 0 ? <p className="sf-rail-empty sf-error">Runs unavailable</p> : null}
        {!failed && committed.length === 0 ? <p className="sf-rail-empty">{board.isLoading ? "Loading…" : "No runs"}</p> : null}
        {committed.length > 0 && shown.length === 0 ? <p className="sf-rail-empty">None</p> : null}
        {shown.map((p) => (
          <RunRow
            key={p.dispatchId}
            row={p.row}
            startedAtMs={p.startedAtMs}
            now={now}
            selected={p.dispatchId === selectedDispatchId}
            liveDetail={live.has(p.dispatchId)}
            onSelect={onSelect}
            intervalMs={intervalMs}
            tabStop={p.dispatchId === rovingId}
            onFocused={setFocusedId}
          />
        ))}
      </div>
    </div>
  );
}
