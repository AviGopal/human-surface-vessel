/**
 * The human half of the one funnel.
 *
 * The substrate's `ui_legibility_scan` files findings about this surface keyed
 * `ui-feedback-<region>-<kind>`. This control files a human's complaint into the
 * SAME keyspace, differing only in `source: human_reported`. That shared key is
 * the point: it is what lets "the detector found it and nobody complained" and
 * "people complained and the detector was silent" both be computed, and those
 * two questions are the only evidence about whether the detector's rules match
 * what people actually notice.
 *
 * The complaint is typed in the one box (16f-3): a message starting with one of
 * the kinds below and a colon. This file keeps only the chips that put a kind in
 * the box; they fill it and never send. The complaint appears in the gap strip
 * within one poll. It is never auto-closed by the detector — a detector may close its own findings on
 * re-observation, but closing a human's report because its three rules pass
 * would be asserting that the human saw nothing.
 */
import type { ReactNode } from "react";
import { COMPLAINT_PREFIXES, fillBox } from "../lib/box";

/** Ask the surface to open the Issues drawer on one issue. Surface listens for this. */
export function showIssue(gapId: string): void {
  window.dispatchEvent(new CustomEvent("sf:show-issue", { detail: gapId }));
}

/** The complaint kinds, as chips that start a complaint in the box. */
export function ComplaintChips(): ReactNode {
  return (
    <div className="sf-complaint-chips">
      {Object.keys(COMPLAINT_PREFIXES).map((p) => (
        <button key={p} type="button" className="sf-chip" onClick={() => fillBox(`${p}: `)}>
          {p}:
        </button>
      ))}
    </div>
  );
}
