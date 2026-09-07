/**
 * The run contract, shown on submit — not before.
 *
 * Long runs need a contract, breadcrumbs, and a salvage path. What this states
 * is: the shapes the walk is likely aiming at, roughly how long this class of
 * work takes, and what it will come back and ASK about rather than decide on
 * its own.
 *
 * THE STANDING OMISSION: no confidence number appears here or anywhere else in
 * this surface. Planner confidence in this system is measurably uncalibrated —
 * runs dispatched at confidence 0.0 outperform runs at 0.9 — so a percentage
 * would launder a known-bad signal into something that reads as measurement.
 * A duration BAND is honest about its own width in a way a point estimate is
 * not, and it is labelled with where it came from.
 */
export interface RunContract {
    readonly targetShapes: readonly string[];
    readonly lowSec: number;
    readonly highSec: number;
    /** Where the band came from. Stated, so it cannot be mistaken for a measurement. */
    readonly bandBasis: string;
    /** What the walk will come back and ask about instead of deciding alone. */
    readonly willAskAbout: readonly string[];
    readonly klass: string;
}
export declare function buildContract(goal: string, inferredShapes: readonly string[]): RunContract;
//# sourceMappingURL=contract.d.ts.map