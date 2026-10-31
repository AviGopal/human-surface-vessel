/**
 * Runs whose reach waits for a person's verdict.
 *
 * The judge alone called these reached, and that is not enough to credit or keep
 * them (goal-host person-verdict.ts): a signed-in person's grade decides. Each row
 * opens the run, whose Grade section is the one grading flow (/api/grade). The
 * system's own goals are listed too, marked, because their window is short and
 * the judge decides when it ends.
 */

import type { ReactNode } from "react";
import type { ActiveDispatch } from "../api/types";

/** "in 42 min", "in 3 h", "in 2 d", or "now" once the window has ended. */
export function lapsesIn(expiresAt: number, now: number): string {
  const ms = expiresAt - now;
  if (!(ms > 0)) return "now";
  const min = Math.ceil(ms / 60_000);
  if (min < 60) return `in ${min} min`;
  const h = Math.round(min / 60);
  return h < 48 ? `in ${h} h` : `in ${Math.round(h / 24)} d`;
}

export function AwaitingVerdicts({
  rows,
  now,
  onSelect,
  selectedDispatchId,
}: {
  rows: readonly ActiveDispatch[];
  now: number;
  onSelect: (dispatchId: string) => void;
  selectedDispatchId: string | null;
}): ReactNode {
  const open = rows.filter((r) => r.personVerdict?.state === "open");
  if (open.length === 0) return null;
  return (
    <section className="sf-awaiting-verdicts" aria-label="Runs awaiting your verdict">
      <h3 className="sf-awaiting-head">Awaiting your verdict · {open.length}</h3>
      <ul>
        {open.map((r) => {
          const pv = r.personVerdict!;
          return (
            <li key={r.dispatchId} data-dispatch-id={r.dispatchId} data-execution-id={pv.executionId} aria-current={r.dispatchId === selectedDispatchId ? "true" : undefined}>
              <button type="button" className="sf-awaiting-open" onClick={() => onSelect(r.dispatchId)}>
                <span className="sf-awaiting-goal">{r.goal?.trim() || "goal text not recorded"}</span>
                <span className="sf-awaiting-mark sf-muted">
                  {pv.originator === "system" ? "the system's own goal · " : ""}the judge said reached · lapses {lapsesIn(pv.expiresAt, now)}
                </span>
                <span className="sf-awaiting-grade">Grade</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
