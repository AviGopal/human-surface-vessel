/**
 * POST /v2/impulses/resolve — the shaped resolver surface.
 *
 * HARD INVARIANT: the `switch (pointer.type)` below and `DISCOVERY_SHAPES` in
 * `../config.ts` must agree EXACTLY. The invariant is made structural rather
 * than documentary two ways:
 *   1. every case label is typed as `DiscoveryShape`, so a case naming a shape
 *      that is not advertised fails to typecheck;
 *   2. `assertExhaustive` in the default branch fails to typecheck if any
 *      advertised shape lacks a case.
 * The 400 body reports `supported_shapes: DISCOVERY_SHAPES` verbatim, so a
 * caller sees the advertised vocabulary, never a hand-copied list.
 */
export declare const impulsesRouter: any;
export default impulsesRouter;
//# sourceMappingURL=impulses.d.ts.map