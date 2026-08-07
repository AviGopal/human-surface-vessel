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
import { useQuery } from "@tanstack/react-query";
import { useLiveControls, useRegionFreeze } from "../state/liveControls";

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

async function fetchGaps(): Promise<readonly InterfaceGap[]> {
  const res = await fetch("/api/gaps", { credentials: "same-origin" });
  if (!res.ok) throw new Error(`gap store unavailable (${res.status})`);
  const j = (await res.json()) as { gaps?: InterfaceGap[] };
  return j.gaps ?? [];
}

const SOURCE_LABEL: Record<string, string> = {
  substrate_detected: "the substrate found this",
  human_reported: "a human reported this",
  operator_narration: "an operator narrated this",
};

function GapRow({ gap }: { gap: InterfaceGap }): ReactNode {
  const closed = gap.status === "closed";
  const meta = gap.classification_metadata ?? {};
  const closedBy = typeof meta["closed_by"] === "string" ? (meta["closed_by"] as string) : null;
  const reopened = typeof gap.reopen_count === "number" && gap.reopen_count > 0;

  return (
    <li className="sf-gap-row" data-status={closed ? "closed" : "open"}>
      <span className="sf-gap-state" data-status={closed ? "closed" : "open"}>
        {closed ? "closed" : "open"}
      </span>
      <span className="sf-gap-body">
        <span className="sf-gap-summary">{gap.summary}</span>
        <span className="sf-gap-meta">
          {SOURCE_LABEL[gap.source] ?? gap.source}
          {closedBy ? ` · closed by ${closedBy} on re-observation` : ""}
          {reopened ? ` · reopened ${gap.reopen_count}×` : ""}
        </span>
      </span>
    </li>
  );
}

export function GapStrip(): ReactNode {
  const { paused, intervalMs } = useLiveControls();
  const { frozen, handlers } = useRegionFreeze();
  const q = useQuery({
    queryKey: ["interfaceGaps"],
    queryFn: fetchGaps,
    enabled: !paused && !frozen,
    refetchInterval: !paused && !frozen ? intervalMs : false,
    refetchOnWindowFocus: false,
    staleTime: 0,
    placeholderData: (previous) => previous,
  });

  const gaps = q.data ?? [];
  const open = gaps.filter((g) => g.status !== "closed");
  const closed = gaps.filter((g) => g.status === "closed");

  return (
    <section className="sf-region sf-gaps" {...handlers}>
      <header className="sf-region-head">
        <span className="sf-eyebrow">What this interface knows is wrong with it</span>
        <span className="sf-gap-count">
          {open.length} open · {closed.length} closed
        </span>
      </header>

      {q.isError ? (
        <p className="sf-gap-empty">
          The gap store is unreachable, so this surface cannot say what is wrong with it. That is
          not the same as nothing being wrong.
        </p>
      ) : gaps.length === 0 ? (
        <p className="sf-gap-empty">
          No legibility findings on record. The detector has either not run against this surface or
          found nothing — those are different, and this view cannot tell them apart.
        </p>
      ) : (
        <ul className="sf-gap-list">
          {open.map((g) => (
            <GapRow key={g.id} gap={g} />
          ))}
          {closed.map((g) => (
            <GapRow key={g.id} gap={g} />
          ))}
        </ul>
      )}
    </section>
  );
}
