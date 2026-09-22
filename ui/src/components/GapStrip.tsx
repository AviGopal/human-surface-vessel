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
import { useEffect, useState, type ReactNode } from "react";
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

/**
 * Where the reader's collapse choice lives.
 *
 * A HUMAN ASKED FOR THIS, in these words: the section "takes up too much space
 * if there are any gaps in the list. Without changing the interface's single
 * screen nature. Allow it to collapse."
 *
 * Two decisions follow from that sentence and are worth defending:
 *
 *  1. DEFAULT OPEN. Collapsing by default would make a surface whose job is to
 *     show what is wrong with it start by hiding what is wrong with it. The
 *     complaint was about space, not about wanting the findings gone.
 *  2. THE COUNT NEVER COLLAPSES. `n open · n closed` stays in the header in
 *     both states, so collapsing changes how much room the list takes and
 *     never whether a reader can tell there is something to read. A collapse
 *     that hid the count would answer the complaint by introducing a worse
 *     one.
 *
 * Persisted, because a preference a person has to re-express on every reload is
 * not a preference the interface has learned. `localStorage` rather than the
 * render policy: this is one reader's view state on one device, not a
 * substrate-wide behaviour, and putting it on the policy impulse would make one
 * person's collapse everybody's.
 */
const COLLAPSE_KEY = "sf.gaps.collapsed";

function readCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {
    // A blocked storage API is not a preference. Fall back to open — the state
    // that shows more, not less.
    return false;
  }
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
  const [collapsed, setCollapsed] = useState(readCollapsed);
  useEffect(() => {
    try {
      window.localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0");
    } catch {
      // Unpersistable is not unusable: the session still honours the choice.
    }
  }, [collapsed]);

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
          {/* NEVER COLLAPSES. See COLLAPSE_KEY. */}
          <span className="sf-gap-count">
            {open.length} open · {closed.length} closed
          </span>
          <button
            type="button"
            className="sf-button sf-button-quiet sf-gap-collapse"
            aria-expanded={!collapsed}
            aria-controls="sf-gaps-body"
            onClick={() => setCollapsed((was) => !was)}
          >
            {collapsed ? "Show findings" : "Hide findings"}
          </button>
        </span>
      </header>

      {/*
        * `sf-region-body`, and the class name is the FIX rather than a wrapper.
        *
        * The one-page stylesheet already carried the bound this section needed
        * — `.sf-gaps .sf-region-body { overflow-y: auto; max-height: 8.5rem }`
        * — and this component never rendered an element it could match, so the
        * cap had no effect and the list grew without limit. That is the whole
        * mechanism behind the complaint that the section "takes up too much
        * space if there are any gaps in the list": a bound was written, named
        * an element that did not exist, and silently did nothing. Attaching it
        * fixes the space complaint even when the section is expanded; the
        * collapse control is the reader's own lever on top of it.
        */}
      {collapsed ? null : (
      <div className="sf-region-body" id="sf-gaps-body">
      <p className="sf-note sf-muted">
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
      </div>
      )}
    </section>
  );
}
