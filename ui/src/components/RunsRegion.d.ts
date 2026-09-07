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
import { type ReactNode } from "react";
export declare function RunsRegion({ selectedDispatchId, onSelect, }: {
    selectedDispatchId: string | null;
    onSelect: (dispatchId: string) => void;
}): ReactNode;
//# sourceMappingURL=RunsRegion.d.ts.map