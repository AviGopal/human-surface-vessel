import type { ReactNode } from "react";
/**
 * Rule P6 made visible. Rendered inside EVERY auto-updating region, so the
 * control is where the reader is when they want it rather than in a settings
 * panel two clicks away.
 *
 * The frozen indicator matters as much as the buttons: a reader whose pointer
 * has silently suspended updates needs to know that is why nothing is moving.
 * Unexplained stillness reads as breakage.
 */
export declare function LiveControls({ frozen, regionName }: {
    frozen: boolean;
    regionName: string;
}): ReactNode;
//# sourceMappingURL=LiveControls.d.ts.map