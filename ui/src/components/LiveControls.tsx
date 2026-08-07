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

      {/*
        The note's WIDTH IS RESERVED by a hidden sizer carrying the longest
        string, with both children stacked in one grid cell.

        Previously this span was empty until the pointer entered the region,
        then grew — displacing the pause button 151.5px to the left, on
        pointerenter. The control that exists to stop the panel moving was
        itself moving out from under the pointer, which made it unclickable by
        mouse and reachable only by keyboard. Reserving the space means the
        message can change without any sibling shifting.
      */}
      <span className="sf-live-note">
        <span className="sf-live-note-sizer" aria-hidden="true">
          held — you are in this region
        </span>
        <span className="sf-live-note-live" aria-live="polite">
          {paused ? (
            <span className="sf-frozen-note">paused</span>
          ) : frozen ? (
            <span className="sf-frozen-note">held — you are in this region</span>
          ) : null}
        </span>
      </span>
    </div>
  );
}
