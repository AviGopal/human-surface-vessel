/**
 * The surface rendering the gap store's view of ITSELF.
 *
 * Two kinds of finding share one keyspace here on purpose:
 *
 *   substrate_detected — the substrate's own legibility scan read this surface
 *                        and judged it against computable rules.
 *   human_reported     — a person complained about this surface.
 *
 * Showing them together is the point. A detector that files into its own
 * private list can never be compared against what humans actually notice; one
 * funnel makes agreement and disagreement visible.
 *
 * `open` and `closed` use the same semantic state tokens as a run verdict, and
 * for the same reason: an unresolved finding must not read quieter than a
 * resolved one.
 */
import type { ReactNode } from "react";
export interface InterfaceGap {
    readonly id: string;
    readonly status: string;
    readonly source: string;
    readonly category: string;
    readonly summary: string;
    readonly closed_at?: string | null;
    readonly reopen_count?: number;
    readonly classification_metadata?: Record<string, unknown>;
}
export declare function GapStrip(): ReactNode;
//# sourceMappingURL=GapStrip.d.ts.map