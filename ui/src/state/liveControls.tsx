/**
 * Rule P6: every auto-updating region exposes a pause control AND an
 * update-interval control. WCAG 2.2.2 requires both at Level A for anything
 * that auto-updates, and there is a second reason here — a reader who is
 * grading a run needs to be able to stop the world while they do it.
 *
 * Pause and interval are SHARED across regions (one world, one clock), and the
 * control is rendered inside each auto-updating region so it is where the
 * reader is when they need it. Freeze-on-interaction is PER REGION: a pointer
 * resting in the detail panel must not stop the board from updating, and vice
 * versa.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type FocusEvent,
  type ReactNode,
} from "react";

export const INTERVAL_OPTIONS = [
  { ms: 1000, label: "1s" },
  { ms: 2000, label: "2s" },
  { ms: 5000, label: "5s" },
  { ms: 15000, label: "15s" },
  { ms: 60000, label: "60s" },
] as const;

export const DEFAULT_INTERVAL_MS = 2000;

interface LiveControlsValue {
  readonly paused: boolean;
  readonly setPaused: (paused: boolean) => void;
  readonly intervalMs: number;
  readonly setIntervalMs: (ms: number) => void;
}

const LiveControlsContext = createContext<LiveControlsValue | null>(null);

export function LiveControlsProvider({ children }: { children: ReactNode }): ReactNode {
  const [paused, setPaused] = useState(false);
  const [intervalMs, setIntervalMs] = useState<number>(DEFAULT_INTERVAL_MS);
  const value = useMemo<LiveControlsValue>(
    () => ({ paused, setPaused, intervalMs, setIntervalMs }),
    [paused, intervalMs],
  );
  return <LiveControlsContext.Provider value={value}>{children}</LiveControlsContext.Provider>;
}

export function useLiveControls(): LiveControlsValue {
  const ctx = useContext(LiveControlsContext);
  if (!ctx) throw new Error("useLiveControls must be used inside LiveControlsProvider");
  return ctx;
}

export interface RegionFreeze {
  /** True while the reader's pointer or focus is inside this region. */
  readonly frozen: boolean;
  /** Spread onto the region element. */
  readonly handlers: {
    readonly onPointerEnter: () => void;
    readonly onPointerLeave: () => void;
    readonly onFocusCapture: () => void;
    readonly onBlurCapture: (e: FocusEvent<HTMLElement>) => void;
  };
}

/**
 * Suspend updates while the reader is IN the region.
 *
 * Held, not discarded: this returns a boolean that gates a query's `enabled`,
 * so the data already fetched stays rendered and polling simply stops. When the
 * pointer leaves, the next poll delivers whatever accumulated — nothing is
 * dropped, it is deferred.
 */
export function useRegionFreeze(): RegionFreeze {
  const [pointerInside, setPointerInside] = useState(false);
  const [focusInside, setFocusInside] = useState(false);

  const onPointerEnter = useCallback(() => setPointerInside(true), []);
  const onPointerLeave = useCallback(() => setPointerInside(false), []);
  const onFocusCapture = useCallback(() => setFocusInside(true), []);
  const onBlurCapture = useCallback((e: FocusEvent<HTMLElement>) => {
    // Focus moving BETWEEN controls inside the region is not leaving it.
    const next = e.relatedTarget;
    if (next instanceof Node && e.currentTarget.contains(next)) return;
    setFocusInside(false);
  }, []);

  return useMemo(
    () => ({
      frozen: pointerInside || focusInside,
      handlers: { onPointerEnter, onPointerLeave, onFocusCapture, onBlurCapture },
    }),
    [pointerInside, focusInside, onPointerEnter, onPointerLeave, onFocusCapture, onBlurCapture],
  );
}
