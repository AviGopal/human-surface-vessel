import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useQuery } from "@tanstack/react-query";
import { useLiveControls, useRegionFreeze } from "../state/liveControls";
import { ComplainButton } from "./ComplainButton";
async function fetchGaps() {
    const res = await fetch("/api/gaps", { credentials: "same-origin" });
    if (!res.ok)
        throw new Error(`gap store unavailable (${res.status})`);
    const j = (await res.json());
    return j.gaps ?? [];
}
const SOURCE_LABEL = {
    substrate_detected: "the substrate found this",
    human_reported: "a human reported this",
    operator_narration: "an operator narrated this",
};
function GapRow({ gap }) {
    const closed = gap.status === "closed";
    const meta = gap.classification_metadata ?? {};
    const closedBy = typeof meta["closed_by"] === "string" ? meta["closed_by"] : null;
    const reopened = typeof gap.reopen_count === "number" && gap.reopen_count > 0;
    return (_jsxs("li", { className: "sf-gap-row", "data-status": closed ? "closed" : "open", children: [_jsx("span", { className: "sf-gap-state", "data-status": closed ? "closed" : "open", children: closed ? "closed" : "open" }), _jsxs("span", { className: "sf-gap-body", children: [_jsx("span", { className: "sf-gap-summary", children: gap.summary }), _jsxs("span", { className: "sf-gap-meta", children: [SOURCE_LABEL[gap.source] ?? gap.source, closedBy ? ` · closed by ${closedBy} on re-observation` : ""] }), reopened ? (_jsxs("span", { className: "sf-gap-reopened", children: ["reopened ", gap.reopen_count, "\u00D7 \u2014 the fix did not hold"] })) : null] })] }));
}
export function GapStrip() {
    const { paused, intervalMs } = useLiveControls();
    const { frozen, handlers } = useRegionFreeze();
    const q = useQuery({
        queryKey: ["interfaceGaps"],
        queryFn: fetchGaps,
        enabled: !paused && !frozen,
        refetchInterval: !paused && !frozen ? intervalMs : false,
        refetchOnWindowFocus: false,
        staleTime: 0,
        placeholderData: (previous) => previous,
    });
    const gaps = q.data ?? [];
    const open = gaps.filter((g) => g.status !== "closed");
    const closed = gaps.filter((g) => g.status === "closed");
    return (_jsxs("section", { className: "sf-region sf-gaps", "aria-labelledby": "sf-gaps-title", ...handlers, children: [_jsxs("header", { className: "sf-region-head", children: [_jsx("h2", { className: "sf-region-title", id: "sf-gaps-title", children: "Known wrong with this interface" }), _jsxs("span", { className: "sf-gap-head-right", children: [_jsx(ComplainButton, { region: "the surface" }), _jsxs("span", { className: "sf-gap-count", children: [open.length, " open \u00B7 ", closed.length, " closed"] })] })] }), _jsx("p", { className: "sf-note sf-muted", style: { margin: "var(--sf-space-4) var(--sf-space-6) 0" }, children: "What this interface knows is wrong with it \u2014 the substrate's own legibility findings and human complaints in one list, so agreement and disagreement between them are visible." }), q.isError ? (_jsx("p", { className: "sf-gap-empty", children: "The gap store is unreachable, so this surface cannot say what is wrong with it. That is not the same as nothing being wrong." })) : gaps.length === 0 ? (_jsx("p", { className: "sf-gap-empty", children: "No legibility findings on record. The detector has either not run against this surface or found nothing \u2014 those are different, and this view cannot tell them apart." })) : (_jsxs("ul", { className: "sf-gap-list", children: [open.map((g) => (_jsx(GapRow, { gap: g }, g.id))), closed.map((g) => (_jsx(GapRow, { gap: g }, g.id)))] }))] }));
}
//# sourceMappingURL=GapStrip.js.map