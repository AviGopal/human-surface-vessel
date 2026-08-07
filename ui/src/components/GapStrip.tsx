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
import { ComplainButton } from "./ComplainButton";

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
        </span>
        {/*
          * A reopen count is the panel's most alarming datum — it says a fix
          * did not hold — and it was rendered in the quietest ink available,
          * at the tail of a metadata line, while `CLOSED` got a badge. It is
          * a badge now, and it is deliberately NOT the closed/open pair: a
          * gap that keeps coming back is neither.
          */}
        {reopened ? (
          <span className="sf-gap-reopened">
            reopened {gap.reopen_count}× — the fix did not hold
          </span>
        ) : null}
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
    /*
     * This region sat OUTSIDE both header systems: its title was a `<span>`
     * on a class with no CSS rule anywhere in the stylesheet, so it rendered
     * as a plain sentence beside three tracked uppercase labels — and the
     * document's heading outline was `Ask, Runs, Detail` and nothing else,
     * which made the region invisible to a screen reader's heading list.
     */
    <section className="sf-region sf-gaps" aria-labelledby="sf-gaps-title" {...handlers}>
      <header className="sf-region-head">
        <h2 className="sf-region-title" id="sf-gaps-title">
          Known wrong with this interface
        </h2>
        <span className="sf-gap-head-right">
          <ComplainButton region="the surface" />
          <span className="sf-gap-count">
            {open.length} open · {closed.length} closed
          </span>
        </span>
      </header>

      <p className="sf-note sf-muted" style={{ margin: "var(--sf-space-4) var(--sf-space-6) 0" }}>
        What this interface knows is wrong with it — the substrate's own legibility findings and
        human complaints in one list, so agreement and disagreement between them are visible.
      </p>

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
