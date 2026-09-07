/**
 * The surface's self-report, in the shape the substrate's own legibility
 * detector already knows how to read.
 *
 * `ui_legibility_scan` (development-vessel) reads a panel's EFFECTIVE token
 * values and component counts and judges them against computable rules. It was
 * written against obsidian-vessel, but it takes its target endpoint as a pointer
 * parameter, so any surface that answers `obsidian:ui_view` can be audited by
 * it. This module is that answer for the human surface.
 *
 * The values below are the REAL effective values this surface renders with —
 * they are the same numbers `@avigopal/design-tokens` emits. Exposing them under
 * the `--sub-font-*` names the detector reads is an adapter, not a fabrication:
 * the detector forms a genuine judgment about genuine values.
 *
 * That is the point of an effect-reading validator. It cannot be fooled by how
 * the surface is factored, only by what it actually renders.
 */
/** Effective font sizes this surface renders with, in px. */
export declare const FONT_SCALE_PX: {
    readonly "--sub-font-xs": 12;
    readonly "--sub-font-sm": 12.5;
    readonly "--sub-font-base": 14.5;
    readonly "--sub-font-lg": 17;
    readonly "--sub-font-xl": 21;
};
/** Component counts the density rule reads. */
export declare const COMPONENT_COUNTS: {
    readonly cards: 3;
    readonly chips: 7;
    readonly feed_lines: 50;
    readonly max_chips_per_row: 7;
};
export interface UiViewReport {
    goal_dispatch: {
        open: boolean;
        effective_tokens: Record<string, string>;
        component_counts: Record<string, number>;
    };
    surface: string;
}
/**
 * `overrides` are the live `renderPolicy.tokenOverrides`. They are folded in
 * here so the detector reads the values the surface is ACTUALLY rendering with
 * right now — not the values it shipped with. An effect-reading validator that
 * reads compile-time defaults is reading a stale surface.
 */
export declare function buildUiView(overrides?: Record<string, string>): UiViewReport;
//# sourceMappingURL=ui-view.d.ts.map