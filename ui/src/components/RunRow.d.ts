/**
 * A verdict-first row (rule P1).
 *
 * The leftmost column is ALWAYS the reach verdict. `status` does not appear in
 * this row at all — not in a corner, not in a tooltip, not smaller. The whole
 * reason this surface exists is that a template exit status was occupying the
 * position a reader scans for the outcome, and a run that exits `completed`
 * with `reached: false` is the measured, dominant failure of this system.
 *
 * The row also never MOVES. Its sort key is `startedAt`, which is fixed for the
 * run's lifetime, so a run progressing from accepted to running to a verdict
 * updates its cells in place and stays exactly where the reader last saw it.
 */
import type { ReactNode } from "react";
import type { ActiveDispatch } from "../api/types";
export interface RunRowProps {
    readonly row: ActiveDispatch;
    readonly startedAtMs: number;
    readonly now: number;
    readonly selected: boolean;
    /**
     * Whether this row may hold its own live walk query. The board carries too
     * few fields to tell `waiting` from `running`, so the newest handful of
     * in-flight rows read their own walk state; the rest fall back to what the
     * board gives.
     */
    readonly liveDetail: boolean;
    readonly onSelect: (dispatchId: string) => void;
    readonly intervalMs: number;
    /**
     * Whether this row currently holds the list's single tab stop. The list is
     * one stop with arrow-key traversal inside it, because 50 consecutive stops
     * that each scrolled a fixed-height window meant a keyboard reader moved the
     * target by reaching for it.
     */
    readonly tabStop: boolean;
    readonly onFocused: (dispatchId: string) => void;
}
export declare function RunRow({ row, startedAtMs, now, selected, liveDetail, onSelect, intervalMs, tabStop, onFocused, }: RunRowProps): ReactNode;
//# sourceMappingURL=RunRow.d.ts.map