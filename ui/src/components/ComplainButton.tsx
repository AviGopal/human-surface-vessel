/**
 * A complaint about the interface is typed in the one box (16f-3): a message starting with one
 * of the kinds below and a colon. It is written as a person's row (`world_changed`, in their
 * own words, under their key), where an ask goes, so the walk takes it up like any other
 * change a person reports. This file keeps only the chips that put a kind in the box; they
 * fill it and never send.
 */
import type { ReactNode } from "react";
import { COMPLAINT_PREFIXES, fillBox } from "../lib/box";

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
