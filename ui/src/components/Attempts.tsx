/**
 * A run's attempts, one line each, under its title: how it went from the
 * first try to the reported one. Read from the walk's own records
 * (lib/attempts: the seed burst opens an attempt, the judge's HOLLOW line is its
 * verdict, the restart line says why the next began), never inferred.
 */

import type { ReactNode } from "react";
import type { GoalWalkState } from "../api/types";
import type { AttemptSegment } from "../lib/attempts";
import { splitVerdict } from "../lib/verdict";

/** What an attempt produced, by shape: request seeds and the goal excluded. */
export function producedShapes(seg: AttemptSegment): readonly string[] {
  const shapes: string[] = [];
  for (const e of seg.events) {
    const shape = typeof e.shape === "string" ? e.shape : null;
    if (!shape || shape === "goal" || shape === "dispatch_id") continue;
    if (typeof e.source === "string" && e.source.startsWith("seed var ")) continue;
    if (!shapes.includes(shape)) shapes.push(shape);
  }
  return shapes;
}

function clock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function Attempts({ walk, segments }: { walk: GoalWalkState; segments: readonly AttemptSegment[] }): ReactNode {
  const running = walk.status === "running";
  if (segments.length < 2 && !running) return null;
  const t0 = segments.find((s) => s.startAt !== null)?.startAt ?? null;
  const norm = (t: string | null | undefined): string => (t ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  const header = norm(walk.goalReachReason);
  return (
    <ol className="sf-attempts" aria-label="Attempts">
      {segments.map((seg) => {
        const outcome = seg.verdict
          ? "rejected"
          : seg.reported && walk.reached === true
            ? "reached"
            : seg.current && running
              ? "running"
              : "unknown";
        const shapes = producedShapes(seg).slice(0, 3);
        return (
          <li key={seg.number} className="sf-attempt-line" data-outcome={outcome} data-reported={seg.reported}>
            <span className="sf-attempt-mark" aria-hidden="true">
              {outcome === "rejected" ? "✗" : outcome === "reached" ? "✓" : outcome === "running" ? "◐" : "·"}
            </span>
            <span className="sf-attempt-n">{seg.number}</span>
            {/* One column for everything else, so a long verdict wraps under its own attempt. */}
            <span className="sf-attempt-body">
              {t0 !== null && seg.startAt !== null ? <span className="sf-muted sf-mono">{clock(seg.startAt - t0)}</span> : null}
              {seg.reason ? <span className="sf-muted">{seg.reason}</span> : null}
              {/* Trace's own condition and words: this browser never saw that attempt's content. */}
              {!seg.current && seg.provenance === null ? <span className="sf-muted">content not retained</span> : null}
              {shapes.map((sh) => (
                <span key={sh} className="sf-shape-badge">{sh}</span>
              ))}
              {seg.reported ? <span className="sf-attempt-reported">reported</span> : null}
              <span className="sf-attempt-outcome">
                {outcome === "rejected" && seg.verdict ? (
                  // The reported attempt's verdict is the header's; an attempt whose verdict
                  // repeats the one before says so. Either way the sentence is not printed again.
                  seg.reported && header && norm(seg.verdict) === header ? (
                    <VerdictText text={seg.verdict} codeOnly note="the verdict above" />
                  ) : seg.number > 1 && norm(seg.verdict) === norm(segments[seg.number - 2]?.verdict) ? (
                    <VerdictText text={seg.verdict} codeOnly note="same as above" />
                  ) : (
                    <VerdictText text={seg.verdict} />
                  )
                ) : outcome === "reached" ? (
                  "reached"
                ) : outcome === "running" ? (
                  "in progress"
                ) : (
                  ""
                )}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** A verdict with its system code, if it has one, drawn as a tag before the text. */
export function VerdictText({ text, codeOnly = false, note }: { text: string; codeOnly?: boolean; note?: string }): ReactNode {
  const v = splitVerdict(text);
  return (
    <>
      {v.code ? <span className="sf-verdict-code sf-mono">{v.code}</span> : null}
      {codeOnly ? <span className="sf-muted">{note}</span> : v.text}
    </>
  );
}
