import type { ReactNode } from "react";
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
export function LiveControls({ frozen, regionName }: { frozen: boolean; regionName: string }): ReactNode {
  const { paused, setPaused, intervalMs, setIntervalMs } = useLiveControls();
  const intervalId = `sf-interval-${regionName}`;

  return (
    <div className="sf-live-controls">
      <button
        type="button"
        className="sf-button"
        onClick={() => setPaused(!paused)}
        aria-pressed={paused}
      >
        {paused ? "Resume updates" : "Pause updates"}
      </button>

      <label htmlFor={intervalId} className="sf-label">
        Every
      </label>
      <select
        id={intervalId}
        className="sf-select"
        value={intervalMs}
        onChange={(e) => setIntervalMs(Number(e.target.value))}
      >
        {INTERVAL_OPTIONS.map((option) => (
          <option key={option.ms} value={option.ms}>
            {option.label}
          </option>
        ))}
      </select>

      <span aria-live="polite">
        {paused ? (
          <span className="sf-frozen-note">paused</span>
        ) : frozen ? (
          <span className="sf-frozen-note">held — you are in this region</span>
        ) : null}
      </span>
    </div>
  );
}
