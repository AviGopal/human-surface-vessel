import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useWalk } from "../api/queries";
import { deriveRunState, verdictSentence } from "../lib/runState";
import { formatElapsed } from "../lib/time";
import { useProgressWatch } from "../lib/useProgressWatch";
import { boardFingerprint, detectSolicitation, hasProgress, progressFingerprint } from "../lib/walk";
import { StateBadge } from "./StateBadge";
export function RunRow({ row, startedAtMs, now, selected, liveDetail, onSelect, intervalMs, tabStop, onFocused, }) {
    const terminal = row.status === "completed" || row.status === "failed";
    const walkQuery = useWalk(row.dispatchId, {
        enabled: liveDetail && !terminal,
        intervalMs,
    });
    const walk = walkQuery.data;
    const fingerprint = walk ? progressFingerprint(walk) : boardFingerprint(row);
    const quietForMs = useProgressWatch(fingerprint, now);
    const solicitation = walk ? detectSolicitation(walk) : null;
    const state = deriveRunState({
        status: row.status,
        reached: row.reached,
        awaitingAnswer: solicitation !== null,
        hasProgress: walk ? hasProgress(walk) : Boolean(row.executionId ?? row.selectedTemplateId),
        quietForMs: terminal ? null : quietForMs,
        acceptedForMs: terminal ? null : Math.max(0, now - startedAtMs),
    });
    const reason = verdictSentence({
        state,
        status: row.status,
        reached: row.reached,
        goalReachReason: walk?.goalReachReason ?? null,
        ...(walk?.error !== undefined ? { error: walk.error } : {}),
        humanGraded: walk?.humanGraded ?? false,
    });
    const goalText = row.goal?.trim();
    return (_jsxs("button", { type: "button", className: "sf-run-row", "data-selected": selected, "data-state": state, "data-dispatch-id": row.dispatchId, tabIndex: tabStop ? 0 : -1, onFocus: () => onFocused(row.dispatchId), onClick: () => onSelect(row.dispatchId), "aria-current": selected ? "true" : undefined, children: [_jsx(StateBadge, { state: state }), _jsx("span", { className: "sf-run-goal", "data-missing": goalText ? "false" : "true", title: goalText ?? "", children: goalText ?? "goal text not recorded on this dispatch" }), _jsx("span", { className: "sf-run-elapsed", children: formatElapsed(now - startedAtMs) }), _jsx("span", { className: "sf-run-meta", children: row.operator ?? row.trigger ?? "unattributed" }), state === "not-reached" || state === "waiting" || state === "stalled" ? (_jsx("span", { className: "sf-run-reason", title: state === "waiting" && solicitation
                    ? `Waiting on you — ${solicitation.evidenceLine}`
                    : reason, children: state === "waiting" && solicitation
                    ? `Waiting on you — ${solicitation.evidenceLine.slice(0, 160)}`
                    : reason })) : null] }));
}
//# sourceMappingURL=RunRow.js.map