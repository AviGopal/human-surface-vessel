/**
 * surfaceIntent — prose typed by a human becomes a renderPolicy patch.
 *
 * WHY THIS IS DETERMINISTIC FIRST. The substrate's rule is that the LLM is one
 * resolver among many and never the controller. A human asking for bigger text
 * is not a reasoning problem; it is a parse. So this module parses, and what it
 * cannot parse it REPORTS as unparsed — with the vocabulary it does understand
 * and a goal text the reader may choose to dispatch. It never silently drops a
 * clause, and it never reports a no-op as success. An escalation to an LLM is
 * therefore an explicit, visible, human-taken step (P2: a suggestion inserts,
 * it never dispatches), not a hidden fallback that launders failure into green.
 *
 * WHY IT IS NOT A BEHAVIOUR GATE (law 1). Nothing here decides how the surface
 * renders. It only translates prose into the `renderPolicy` impulse, which the
 * surface reads at use time. Change the impulse by any other route and the
 * surface changes identically; delete this module and rendering is unaffected.
 * The numbers below (12px, 14.5px, …) are not policy: they are a transcript of
 * the shipped defaults in `packages/design-tokens/tokens.css`, needed only so a
 * relative instruction ("bigger") has something to be relative TO when no
 * override is in force yet. `src/` cannot import that package, so they are
 * mirrored here and named as a mirror.
 *
 * MERGE, NEVER REPLACE. `writeRenderPolicy` swaps whole maps: passing
 * `formByShape` replaces every pin, not just the named one. Every read here
 * starts from the LIVE policy and merges into a copy, so one person's
 * instruction cannot silently delete another's override.
 */
import type { RenderPolicy } from "./store.js";
export declare const CONTENT_FORMS: readonly ["prose", "text", "rows", "diff", "empty", "terminal", "record", "scalar", "stub"];
export type ContentForm = (typeof CONTENT_FORMS)[number];
/**
 * Forms a human may NOT pin onto a shape.
 *
 * Both of these are facts about the CONTENT rather than presentation
 * preferences, and pinning one would hide the thing it describes: an `empty`
 * pin on a shape that later carries content renders that content as an
 * emptiness notice, and a `stub` pin claims "no content carried" over a payload
 * that was carried. A pin has to be a preference to be honourable.
 */
export declare const NON_PINNABLE_FORMS: readonly ["empty", "stub"];
export declare const PINNABLE_FORMS: readonly ContentForm[];
/**
 * MIRROR ASSERTION.
 *
 * `packages/design-tokens/index.ts` carries a byte-identical copy of the block
 * above, because the vessel is a submodule that must not reach into the
 * super-repo for a runtime import (law 11) — and neither of the two build
 * graphs that compile these files can see the other's directory: the vessel
 * typechecks with only its own repo mounted, the UI builds with only `ui/` and
 * that package on the path. A shared import is therefore not available, and
 * this assertion is honest about what it does and does not buy:
 *
 *   it PROVES  — this file's array and its written-out union agree, so the
 *                half-edit that grows one without the other fails to compile
 *                here AND, identically, over there;
 *   it does NOT prove the two FILES agree. That is convention, and the
 *                assertion text is duplicated verbatim so the two blocks diff
 *                cleanly against each other.
 */
type MirroredForm = "prose" | "text" | "rows" | "diff" | "empty" | "terminal" | "record" | "scalar" | "stub";
type FormsMirrorOk = [ContentForm] extends [MirroredForm] ? [MirroredForm] extends [ContentForm] ? true : never : never;
export declare const CONTENT_FORMS_MIRRORED: FormsMirrorOk;
export interface IntentChange {
    /** What moved, in the policy's own vocabulary. */
    readonly field: string;
    readonly from: string;
    readonly to: string;
    /** The clause that caused it — so a reader can see WHICH words did WHAT. */
    readonly because: string;
    /** Set when a bound constrained the request. Never silently applied. */
    readonly clamped?: string;
    /** The concrete values written, when the change moved a whole scale. */
    readonly detail?: Readonly<Record<string, string>>;
}
export interface UnparsedClause {
    readonly text: string;
    readonly reason: string;
    /**
     * The clause WAS read; it just asks for the state already in force. It is
     * reported here rather than in `changes` because nothing moved, and a
     * no-op must never be dressed as a change — but it is flagged so a reader
     * is not told their English was unreadable when it was merely redundant.
     */
    readonly no_op?: true;
    /**
     * A goal a human MAY choose to send. This module does not dispatch it and
     * must never be changed to (P2).
     */
    readonly suggested_goal: string;
}
export interface RenderPolicyPatch {
    tokenOverrides?: Record<string, string>;
    formByShape?: Record<string, string>;
    maxPreviewChars?: number | null;
    ledgerDefaultExpanded?: boolean;
    note?: string | null;
}
export interface IntentReading {
    readonly text: string;
    readonly changes: readonly IntentChange[];
    readonly unparsed: readonly UnparsedClause[];
    /** True when at least one clause moved the policy. */
    readonly understood: boolean;
    readonly patch: RenderPolicyPatch;
    /** What this parser can read, offered whenever something was not read. */
    readonly grammar: readonly string[];
}
export declare const GRAMMAR: readonly string[];
/**
 * Read prose against the LIVE policy and return what it would change.
 *
 * Pure: it writes nothing. The caller applies `patch` through
 * `writeRenderPolicy`, so the change lands as a shaped impulse the surface
 * reads at use time, exactly as any other author of that impulse would.
 */
export declare function readSurfaceIntent(text: string, current: RenderPolicy): IntentReading;
export {};
//# sourceMappingURL=surface-intent.d.ts.map