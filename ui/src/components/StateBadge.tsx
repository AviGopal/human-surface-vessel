import { STATE_TOKENS, type RunState } from "@avigopal/design-tokens";
import type { ReactNode } from "react";

/**
 * State is never carried by colour alone: every badge ships a WORD and a
 * non-colour mark alongside the hue. A reader who cannot distinguish the
 * palette still reads the verdict.
 *
 * The colour comes from the token map, not from a literal in this file
 * (rule P11) — the `data-state` attribute selects the token in CSS, so a probe
 * can assert the row rendered `var(--sf-not-reached)` rather than asserting a
 * hex value that means nothing about intent.
 */
const MARKS: Readonly<Record<RunState, string>> = {
  reached: "●",
  "not-reached": "●",
  running: "◐",
  waiting: "?",
  accepted: "○",
  stalled: "◌",
};

export function StateBadge({ state }: { state: RunState }): ReactNode {
  return (
    <span className="sf-verdict" data-state={state}>
      <span className="sf-verdict-mark" aria-hidden="true">
        {MARKS[state]}
      </span>
      {STATE_TOKENS[state].label}
    </span>
  );
}
