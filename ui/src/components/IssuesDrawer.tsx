/**
 * What is known to be wrong with this interface: the substrate's own legibility
 * findings and human reports, in one list. Opened from the top bar; it overlays
 * the main pane rather than taking permanent room from it.
 */

import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, type ReactNode } from "react";
import { useLiveControls } from "../state/liveControls";
import { streamAwareInterval, useStreamConnected } from "../state/stream";
import { fromText } from "../lib/content";
import { ComplainButton } from "./ComplainButton";
import { Rendered } from "./Rendered";

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
const SOURCE_LABEL: Record<string, string> = {
  substrate_detected: "found by the substrate",
  human_reported: "reported by a human",
  operator_narration: "operator note",
};

export function useInterfaceGaps() {
  const { paused, intervalMs } = useLiveControls();
  const live = useStreamConnected();
  return useQuery({
    queryKey: ["interfaceGaps"],
    queryFn: fetchGaps,
    enabled: !paused,
    refetchInterval: !paused ? streamAwareInterval(Math.max(intervalMs, 15000), live) : false,
    refetchOnWindowFocus: false,
    placeholderData: (previous) => previous,
  });
}

/** First sentence as the lead; the remainder is available, not imposed. */
function splitLead(summary: string): { lead: string; rest: string } {
  const text = summary.replace(/^\s*\[narrowed from [^\]]*\]\s*/, "").trim();
  const m = /^(.{20,240}?[.!?])\s+(.*)$/s.exec(text);
  if (m && m[1] && m[2]) return { lead: m[1], rest: m[2] };
  if (text.length <= 240) return { lead: text, rest: "" };
  return { lead: `${text.slice(0, 240).trimEnd()}…`, rest: text };
}

function GapCard({ gap, highlighted }: { gap: InterfaceGap; highlighted?: boolean }): ReactNode {
  const closed = gap.status === "closed";
  const closedBy = typeof gap.classification_metadata?.["closed_by"] === "string" ? (gap.classification_metadata["closed_by"] as string) : null;
  const { lead, rest } = splitLead(gap.summary);
  return (
    <li className="sf-issue" data-status={closed ? "closed" : "open"} data-gap-id={gap.id} data-highlight={highlighted ? "true" : undefined}>
      <p className="sf-issue-facts">
        <span className="sf-gap-state" data-status={closed ? "closed" : "open"}>
          {closed ? "closed" : "open"}
        </span>
        {typeof gap.reopen_count === "number" && gap.reopen_count > 0 ? (
          <span className="sf-gap-reopened">reopened {gap.reopen_count}×</span>
        ) : null}
        <span>{SOURCE_LABEL[gap.source] ?? gap.source}</span>
        {closedBy ? <span>closed by {closedBy}</span> : null}
      </p>
      <p className="sf-issue-lead">{lead}</p>
      {rest ? (
        <details className="sf-issue-more">
          <summary>More</summary>
          <Rendered content={fromText("interface_gap", rest)} density="inline" header={false} region="issue_card" />
        </details>
      ) : null}
      <p className="sf-issue-id sf-mono">{gap.id}</p>
    </li>
  );
}

export function IssuesDrawer({ onClose, highlightId }: { onClose: () => void; highlightId?: string | null }): ReactNode {
  const q = useInterfaceGaps();
  const gaps = q.data ?? [];
  const highlightListed = highlightId ? gaps.some((g) => g.id === highlightId) : false;
  const listRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!highlightId || !highlightListed) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-gap-id="${CSS.escape(highlightId)}"]`);
    el?.scrollIntoView({ block: "center" });
  }, [highlightId, highlightListed]);
  const open = gaps.filter((g) => g.status !== "closed");
  const closed = gaps.filter((g) => g.status === "closed");

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <aside id="sf-issues" className="sf-issues" aria-labelledby="sf-issues-title" ref={listRef}>
      <header className="sf-issues-head">
        <h2 id="sf-issues-title" className="sf-view-title">
          Issues with this interface
        </h2>
        <button type="button" className="sf-icon-button" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </header>
      <div className="sf-issues-report">
        <ComplainButton region="the surface" />
      </div>
      {q.isError ? <p className="sf-error">Issue list unavailable</p> : null}
      {highlightId && q.data && !highlightListed ? (
        <p className="sf-outcome-strip" data-outcome="waiting">
          … Your report <span className="sf-mono">{highlightId}</span> is not listed yet — the list refreshes when it lands.
        </p>
      ) : null}
      {!q.isError && q.data && gaps.length === 0 ? <p className="sf-main-empty">None recorded</p> : null}
      <ul className="sf-issue-list">
        {open.map((g) => (
          <GapCard key={g.id} gap={g} highlighted={g.id === highlightId} />
        ))}
      </ul>
      {closed.length > 0 ? (
        <details className="sf-issues-closed">
          <summary>{closed.length} closed</summary>
          <ul className="sf-issue-list">
            {closed.map((g) => (
              <GapCard key={g.id} gap={g} highlighted={g.id === highlightId} />
            ))}
          </ul>
        </details>
      ) : null}
    </aside>
  );
}
