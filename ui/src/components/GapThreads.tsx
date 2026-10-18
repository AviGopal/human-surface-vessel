/**
 * The system's own work on its gaps, one thread per gap: its status, how many
 * attempts its lane made, how many landed, and whether it came back. Each attempt
 * opens its run when the ledger recorded one. This node's ledger only.
 */

import type { ReactNode } from "react";
import type { GapThreadView } from "../api/client";

function shortGap(id: string): string {
  return id.replace(/-\d{4}-\d{2}-\d{2}(T\d+)?$/, "").replace(/-/g, " ");
}

export function GapThreads({ threads, onSelect, selectedDispatchId }: { threads: readonly GapThreadView[]; onSelect: (dispatchId: string) => void; selectedDispatchId: string | null }): ReactNode {
  if (threads.length === 0) return null;
  return (
    <section className="sf-gap-threads" aria-label="Gap threads on this node">
      <h3 className="sf-gap-threads-head">Gaps · this node</h3>
      {threads.map((t) => {
        const open = t.attempts.some((a) => a.dispatchId === selectedDispatchId);
        return (
          <details key={t.gapId} className="sf-gap-thread" data-status={t.status ?? "unknown"} open={open}>
            <summary>
              <span className="sf-gap-title" title={t.summary ?? t.gapId}>
                {t.summary ?? shortGap(t.gapId)}
              </span>
              <span className="sf-gap-mark">
                {t.status ?? "not in the store"} · {t.attemptCount} {t.attemptCount === 1 ? "attempt" : "attempts"} · {t.landedCount} landed
                {t.reopenCount > 0 ? ` · reopened ${t.reopenCount}` : ""}
              </span>
            </summary>
            <ol className="sf-gap-attempts">
              {t.attempts.map((a) => (
                <li key={a.attemptId} data-landed={a.landed}>
                  <span className="sf-gap-when">{a.at ? a.at.slice(5, 16).replace("T", " ") : "—"}</span>
                  <span>{[a.route, a.outcome, a.verdict].filter(Boolean).join(" · ") || "no outcome recorded"}</span>
                  {a.commit ? <span className="sf-mono"> · {a.commit.slice(0, 7)}</span> : null}
                  {a.dispatchId ? (
                    <button type="button" className="sf-button sf-button-quiet" onClick={() => onSelect(a.dispatchId!)}>
                      run
                    </button>
                  ) : (
                    <span className="sf-muted"> · no run recorded</span>
                  )}
                </li>
              ))}
              {t.attemptCount > t.attempts.length ? <li className="sf-muted">{t.attemptCount - t.attempts.length} earlier</li> : null}
              <li className="sf-muted">Deploy and configuration steps: not readable yet</li>
            </ol>
          </details>
        );
      })}
    </section>
  );
}
