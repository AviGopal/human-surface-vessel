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
import { type FocusEvent, type ReactNode } from "react";
export declare const INTERVAL_OPTIONS: readonly [{
    readonly ms: 1000;
    readonly label: "1s";
}, {
    readonly ms: 2000;
    readonly label: "2s";
}, {
    readonly ms: 5000;
    readonly label: "5s";
}, {
    readonly ms: 15000;
    readonly label: "15s";
}, {
    readonly ms: 60000;
    readonly label: "60s";
}];
export declare const DEFAULT_INTERVAL_MS = 2000;
interface LiveControlsValue {
    readonly paused: boolean;
    readonly setPaused: (paused: boolean) => void;
    readonly intervalMs: number;
    readonly setIntervalMs: (ms: number) => void;
}
export declare function LiveControlsProvider({ children }: {
    children: ReactNode;
}): ReactNode;
export declare function useLiveControls(): LiveControlsValue;
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
export declare function useRegionFreeze(): RegionFreeze;
export {};
//# sourceMappingURL=liveControls.d.ts.map