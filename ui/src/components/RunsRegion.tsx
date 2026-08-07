/**
 * The RUNS board.
 *
 * Fixed height, from `--sf-live-region-height`. It does not grow with its
 * contents, so nothing on the page below it moves when a run arrives.
 *
 * Three rules meet here:
 *
 *  P3 — arrivals that would land ABOVE the reader's viewport are buffered
 *       behind a count they accept, never spliced in. A row sliding out from
 *       under a moving hand is the attested failure this region was rebuilt to
 *       fix: a run left the board the instant it settled, which is exactly when
 *       it became worth reading.
 *  P5 — the sort key is fixed for a run's lifetime, so an existing row never
 *       moves; only insertions can disturb the layout, and P3 governs those.
 *  P6 — pause and interval controls, plus freeze-on-interaction implemented as
 *       the query's `enabled` flag so state is HELD rather than discarded.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useBoard } from "../api/queries";
import type { ActiveDispatch } from "../api/types";
import { sortRuns } from "../lib/sort";
import { parseStartedAt } from "../lib/time";
import { useNow } from "../lib/useNow";
import { useLiveControls, useRegionFreeze } from "../state/liveControls";
import { LiveControls } from "./LiveControls";
import { RunRow } from "./RunRow";

/** How many in-flight rows may hold their own walk query. */
const LIVE_DETAIL_BUDGET = 6;

interface Positioned {
  readonly row: ActiveDispatch;
  readonly dispatchId: string;
  readonly startedAtMs: number;
}

function position(rows: readonly ActiveDispatch[], fallback: number): readonly Positioned[] {
  return rows.map((row) => ({
    row,
    dispatchId: row.dispatchId,
    startedAtMs: parseStartedAt(row.startedAt, fallback),
  }));
}

export function RunsRegion({
  selectedDispatchId,
  onSelect,
}: {
  selectedDispatchId: string | null;
  onSelect: (dispatchId: string) => void;
}): ReactNode {
  const { paused, intervalMs } = useLiveControls();
  const { frozen, handlers } = useRegionFreeze();
  const live = !paused && !frozen;
  const now = useNow(paused);

  const board = useBoard({ enabled: live, intervalMs });

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [committed, setCommitted] = useState<readonly Positioned[]>([]);
  const [buffered, setBuffered] = useState<readonly Positioned[]>([]);

  const data = board.data;
  /** Every dispatch id this region has ever accounted for, committed or buffered. */
  const knownRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!data) return;
    const incoming = position(data, Date.now());
    const incomingById = new Map(incoming.map((p) => [p.dispatchId, p]));

    // The reader is at the top and not interacting: an arrival lands at the top
    // of the viewport where they can see it, which is the live-tail behaviour a
    // board at rest should have. Anywhere else, buffer — an insertion above the
    // viewport pushes everything the reader is looking at downward.
    const atTop = (scrollRef.current?.scrollTop ?? 0) <= 0;
    const acceptsArrivals = atTop && !frozen && !paused;

    const arrivals = incoming.filter((p) => !knownRef.current.has(p.dispatchId));

    setCommitted((prev) => {
      // Existing rows: refresh their DATA in place, but PIN the sort key to
      // what it was at first observation.
      //
      // This is the P5 failure the spec warns a parser cannot see: the
      // comparator is clean, and it can still be fed a value that changes. A
      // row whose `startedAt` arrived null gets a synthetic fallback of
      // `Date.now()`, and taking the incoming entry wholesale would restamp
      // that fallback on EVERY poll — so the row would drift around the board
      // every couple of seconds for no reason a reader could ever explain.
      // Pinning at first observation makes the key immutable in fact, not just
      // in intent.
      const refreshed = prev
        .map((p) => {
          const next = incomingById.get(p.dispatchId);
          return next ? { ...next, startedAtMs: p.startedAtMs } : p;
        })
        // A row that has fallen off the 50-run board is dropped only when the
        // reader is not in the middle of using the region, and never when it is
        // the run they have open.
        .filter(
          (p) =>
            incomingById.has(p.dispatchId) ||
            p.dispatchId === selectedDispatchId ||
            frozen ||
            !atTop,
        );
      return acceptsArrivals && arrivals.length > 0
        ? sortRuns([...refreshed, ...arrivals])
        : sortRuns(refreshed);
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

  /**
   * The reader ASKED for the arrivals, so this is the one place the board may
   * move: it commits the buffer and takes them to the top. An explicit gesture,
   * not an ambush.
   */
  const acceptBuffered = useCallback(() => {
    setCommitted((prev) => {
      const known = new Set(prev.map((p) => p.dispatchId));
      const fresh = buffered.filter((p) => !known.has(p.dispatchId));
      return sortRuns([...prev, ...fresh]);
    });
    setBuffered([]);
    scrollRef.current?.scrollTo({ top: 0 });
  }, [buffered]);

  const nonTerminalSeen = new Set<string>();
  for (const p of committed) {
    if (p.row.status === "running" && nonTerminalSeen.size < LIVE_DETAIL_BUDGET) {
      nonTerminalSeen.add(p.dispatchId);
    }
  }

  return (
    <section className="sf-region" aria-labelledby="sf-runs-title" {...handlers}>
      <div className="sf-region-head">
        <h2 className="sf-region-title" id="sf-runs-title">
          Runs
        </h2>
        <LiveControls frozen={frozen} regionName="runs" />
      </div>

      <div className="sf-runs-viewport">
        {buffered.length > 0 ? (
          <button type="button" className="sf-new-pill" onClick={acceptBuffered}>
            ↑ {buffered.length} new — show {buffered.length === 1 ? "it" : "them"}
          </button>
        ) : null}

        <div
          className="sf-runs-scroll"
        ref={scrollRef}
        role="log"
        aria-live="polite"
        aria-relevant="additions text"
        aria-busy={board.isFetching}
        aria-label="Dispatched runs, newest first"
      >
        {board.isError && committed.length === 0 ? (
          <p className="sf-error" style={{ margin: "var(--sf-space-4)" }}>
            The board could not be read: {(board.error as Error).message}. This is the surface
            failing, not the fleet being idle — nothing here says anything about what is running.
          </p>
        ) : null}

        {committed.length === 0 && !board.isError ? (
          <p className="sf-empty">
            {board.isLoading ? "Reading the board…" : "Nothing has been dispatched yet."}
          </p>
        ) : null}

        {committed.map((p) => (
          // P4: keyed on the dispatch id. An index key here would rebind a row's
          // component state — its stall clock, its open state — to a POSITION,
          // so one arrival at the top would silently hand every row below it
          // somebody else's history.
          <RunRow
            key={p.dispatchId}
            row={p.row}
            startedAtMs={p.startedAtMs}
            now={now}
            selected={p.dispatchId === selectedDispatchId}
            liveDetail={nonTerminalSeen.has(p.dispatchId)}
            onSelect={onSelect}
            intervalMs={intervalMs}
          />
        ))}
        </div>
      </div>

      <div className="sf-region-head" style={{ borderTop: "1px solid var(--sf-rule)", borderBottom: "none" }}>
        <p className="sf-note" style={{ margin: 0 }}>
          The board carries at most 50 runs. A verdict here is what the walk recorded — open a run to
          see what it actually produced.
        </p>
      </div>
    </section>
  );
}
