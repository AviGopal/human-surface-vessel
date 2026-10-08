import { STATE_TOKENS, type RunState } from "@avigopal/design-tokens";
import type { ReactNode } from "react";
import { formatElapsed } from "../lib/time";

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

/** `quietForMs`: for `stalled`, the silence that made it so — the fact beside the word. */
export function StateBadge({ state, quietForMs = null }: { state: RunState; quietForMs?: number | null }): ReactNode {
  return (
    <span className="sf-verdict" data-state={state}>
      <span className="sf-verdict-mark" aria-hidden="true">
        {MARKS[state]}
      </span>
      {STATE_TOKENS[state].label}
      {quietForMs !== null ? <span className="sf-verdict-quiet"> · quiet {formatElapsed(quietForMs)}</span> : null}
    </span>
  );
}
