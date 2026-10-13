/**
 * A run's attempts, one line each, under its title: how it went from the
 * first try to the reported one. Read from the walk's own records
 * (lib/attempts: the seed burst opens an attempt, the judge's HOLLOW line is its
 * verdict, the restart line says why the next began), never inferred.
 */

import type { ReactNode } from "react";
import type { GoalWalkState } from "../api/types";
import type { AttemptSegment } from "../lib/attempts";

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
            {t0 !== null && seg.startAt !== null ? <span className="sf-muted sf-mono">{clock(seg.startAt - t0)}</span> : null}
            {seg.reason ? <span className="sf-muted">{seg.reason}</span> : null}
            {shapes.map((sh) => (
              <span key={sh} className="sf-shape-badge">{sh}</span>
            ))}
            <span className="sf-attempt-outcome">
              {outcome === "rejected" ? seg.verdict : outcome === "reached" ? "reached" : outcome === "running" ? "in progress" : ""}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
