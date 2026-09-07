import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { STATE_TOKENS } from "@avigopal/design-tokens";
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
const MARKS = {
    reached: "●",
    "not-reached": "●",
    running: "◐",
    waiting: "?",
    accepted: "○",
    stalled: "◌",
};
export function StateBadge({ state }) {
    return (_jsxs("span", { className: "sf-verdict", "data-state": state, children: [_jsx("span", { className: "sf-verdict-mark", "aria-hidden": "true", children: MARKS[state] }), STATE_TOKENS[state].label] }));
}
//# sourceMappingURL=StateBadge.js.map