/**
 * The system's own work on its gaps, one thread per gap: its status, how many
 * attempts its lane made, how many landed, and whether it came back. Each attempt
 * opens its run when the ledger recorded one. This node's ledger only.
 */

import type { ReactNode } from "react";
import type { GapThreadView } from "../api/client";

type Attempt = GapThreadView["attempts"][number];

/** What an attempt came to, as its line reads. */
function attemptLine(a: Attempt): string {
  return [a.route, a.outcome, a.verdict].filter(Boolean).join(" · ") || "no outcome recorded";
}

/**
 * Attempts newest first, with a run of the same outcome and no run to open folded
 * into one line: ten refusals read as one line "×10", not ten lines.
 */
export function foldAttempts(attempts: readonly Attempt[]): { first: Attempt; last: Attempt; count: number }[] {
  const out: { first: Attempt; last: Attempt; count: number }[] = [];
  for (const a of attempts) {
    const prev = out.at(-1);
    const same = prev && !a.dispatchId && !prev.first.dispatchId && !a.landed && !prev.first.landed && !a.commit && attemptLine(a) === attemptLine(prev.first);
    if (same) {
      prev.last = a;
      prev.count++;
    } else out.push({ first: a, last: a, count: 1 });
  }
  return out;
}

const when = (at: string | null): string => (at ? at.slice(5, 16).replace("T", " ") : "—");

function shortGap(id: string): string {
  return id.replace(/-\d{4}-\d{2}-\d{2}(T\d+)?$/, "").replace(/-/g, " ");
}

export function GapThreads({ threads, onSelect, selectedDispatchId }: { threads: readonly GapThreadView[]; onSelect: (dispatchId: string) => void; selectedDispatchId: string | null }): ReactNode {
  if (threads.length === 0) return null;
  return (
    <section className="sf-gap-threads" aria-label="Gap threads on this node">
      <h3 className="sf-gap-threads-head">Gaps · this node</h3>
      {threads.map((t) => {
        // Open only around the run on screen; an attempt with no run never matches "nothing selected".
        const open = selectedDispatchId !== null && t.attempts.some((a) => a.dispatchId === selectedDispatchId);
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
              {foldAttempts(t.attempts).map(({ first: a, last, count }) => (
                <li key={a.attemptId} data-landed={a.landed}>
                  <span className="sf-gap-when">{count > 1 ? `${when(last.at)} – ${when(a.at)}` : when(a.at)}</span>
                  <span>{attemptLine(a)}</span>
                  {count > 1 ? <span className="sf-muted"> ×{count}</span> : null}
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
            </ol>
          </details>
        );
      })}
    </section>
  );
}
