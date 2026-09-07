import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { INTERVAL_OPTIONS, useLiveControls } from "../state/liveControls";
/**
 * Rule P6 made visible. Rendered inside EVERY auto-updating region, so the
 * control is where the reader is when they want it rather than in a settings
 * panel two clicks away.
 *
 * The frozen indicator matters as much as the buttons: a reader whose pointer
 * has silently suspended updates needs to know that is why nothing is moving.
 * Unexplained stillness reads as breakage.
 */
export function LiveControls({ frozen, regionName }) {
    const { paused, setPaused, intervalMs, setIntervalMs } = useLiveControls();
    const intervalId = `sf-interval-${regionName}`;
    return (_jsxs("div", { className: "sf-live-controls", children: [_jsx("button", { type: "button", className: "sf-button", onClick: () => setPaused(!paused), "aria-pressed": paused, children: paused ? "Resume updates" : "Pause updates" }), _jsx("label", { htmlFor: intervalId, className: "sf-label", children: "Every" }), _jsx("select", { id: intervalId, className: "sf-select", value: intervalMs, onChange: (e) => setIntervalMs(Number(e.target.value)), children: INTERVAL_OPTIONS.map((option) => (_jsx("option", { value: option.ms, children: option.label }, option.ms))) }), _jsxs("span", { className: "sf-live-note", children: [_jsx("span", { className: "sf-live-note-sizer", "aria-hidden": "true", children: "held \u2014 you are in this region" }), _jsx("span", { className: "sf-live-note-live", "aria-live": "polite", children: paused ? (_jsx("span", { className: "sf-frozen-note", children: "paused" })) : frozen ? (_jsx("span", { className: "sf-frozen-note", children: "held \u2014 you are in this region" })) : null })] })] }));
}
//# sourceMappingURL=LiveControls.js.map