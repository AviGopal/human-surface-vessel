/**
 * Starters, derived from the LIVE shape vocabulary at render time.
 *
 * There is no hardcoded starter array in this file and there must never be
 * one. The blank box is the bug: a person facing an empty textarea with no
 * indication of what the system can actually do will either ask for something
 * it cannot do, or ask for nothing. But a fixed list of examples is the same
 * bug wearing a coat — it goes stale the moment the fleet changes, and then it
 * advertises capabilities that no longer exist.
 *
 * So: take the shapes discovery is advertising right now, throw out the ones
 * that cannot be the TARGET of a human goal, and phrase what is left as a
 * concrete task. Ranking and phrasing are deterministic, so the chips do not
 * reshuffle between renders.
 *
 * ── Two rules this file learned the hard way ────────────────────────────────
 *
 * 1. FAMILY MATCHING RUNS ON THE HUMANIZED NAME, WITH WORD BOUNDARIES.
 *    Matching `/patch/` against the raw shape name ranked `activeDispatches`,
 *    `goalDispatchAsync` and `light_dispatch_execution` as the top "change a
 *    file" suggestions, because `dispatch` contains `patch`. A substring test
 *    against a machine identifier will eventually match a word that is not
 *    there. `humanizeShape` already splits camelCase and snake_case into words,
 *    so matching `\bpatch\b` on its output is both correct and uniform across
 *    both naming conventions.
 *
 * 2. RANK AND PHRASING COME FROM ONE TABLE, NOT TWO PARALLEL REGEX LISTS.
 *    They used to be separate functions with separately maintained patterns,
 *    which meant a shape could be ranked into one family and phrased as
 *    another — the ordering promised something the chip text did not deliver.
 *    `FAMILIES` below is the single source: position in the array IS the rank.
 */
export interface Starter {
    /** Stable key — the shape it was derived from. Never an array index. */
    readonly id: string;
    readonly shape: string;
    /** Short chip label. */
    readonly label: string;
    /** What gets INSERTED into the input. Clicking never dispatches (rule P2). */
    readonly text: string;
    /**
     * null while the producer lookup is still in flight. The chip renders
     * immediately either way — capability enrichment refines a chip that is
     * already on screen, it never gates the first paint.
     */
    readonly hasProducer: boolean | null;
}
export declare function humanizeShape(shape: string): string;
/** Exported for the derivation test harness and for `inferTargetShapes`. */
export declare function isHumanGoalTarget(shape: string): boolean;
export declare function deriveStarters(shapes: readonly string[], limit: number): readonly Starter[];
/**
 * Infer which shapes a goal is likely aiming at, from the live vocabulary.
 * Used for the run contract — stated as an inference, never as a promise.
 */
export declare function inferTargetShapes(goal: string, shapes: readonly string[], limit?: number): readonly string[];
//# sourceMappingURL=starters.d.ts.map