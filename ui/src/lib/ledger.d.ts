/**
 * The evidence ledger: what a walk actually put in the pool.
 *
 * Two rules are enforced here rather than in the components, because a rule
 * enforced in a component is a rule the next component forgets.
 *
 * 1. The empty-content case is a SEPARATE VARIANT, not a missing field.
 *    goal-host omits `contentPreview` and `truncated` entirely when an impulse
 *    carried nothing, so `entry.truncated === false` is never true for an empty
 *    impulse — it is `undefined`. Normalizing into a discriminated union makes
 *    the empty case impossible to render by accident as a blank content block.
 *
 * 2. Rendering dispatches on the FORM of the content, never on the shape name
 *    (rule P9). The registry advertises hundreds of shapes and the set is open
 *    and ragged — two live entries are entire prose sentences registered as
 *    shape names. Content, though, arrives in a small closed set of forms. The
 *    shape is a badge; the form drives the renderer; and the verbatim branch is
 *    the designed common case, not the error case.
 *
 * 3. The ENVELOPE PRE-PASS decides WHICH content is drawn, and it is therefore
 *    a transform here rather than a form. Making it a form would let a human
 *    pin `shellResult` to "envelope" and get a permanent double-render, and it
 *    would collide with the payload's own form; it has no renderer of its own,
 *    because its output is always some other form. Measured: three of three
 *    pool entries on each reached run arrived as a JSON OBJECT — most of them
 *    `{shape, stdout, stderr, exit_code}` — whose 33-line stdout rendered as
 *    one logical line of literal two-character `\n` sequences. The object is
 *    the single most common content form the pool produces and it had no
 *    branch anywhere.
 */
import { type ContentForm } from "@avigopal/design-tokens";
import type { RawProvenance } from "../api/types";
/** goal-host caps `contentPreview`; `chars` is the TRUE length. */
export declare const PREVIEW_CAP = 2000;
export type LedgerEntry = {
    readonly kind: "content";
    readonly shape: string;
    readonly goalSignature: string | null;
    readonly producedBy: string | null;
    readonly preview: string;
    readonly chars: number;
    readonly truncated: boolean;
} | {
    readonly kind: "empty";
    readonly shape: string;
    readonly goalSignature: string | null;
    readonly producedBy: string | null;
};
/**
 * Turn one wire entry into something safe to render, or null if it is not an
 * entry at all.
 */
export declare function normalizeProvenance(raw: RawProvenance | unknown): LedgerEntry | null;
export declare function normalizeLedger(raw: readonly unknown[] | undefined): readonly LedgerEntry[];
/**
 * The guess, and only ever the guess. It is applied to a raw preview and to an
 * unwrapped envelope payload alike; `fromEnvelope` is the difference, and it is
 * the only positive evidence this function has that the text it is holding came
 * out of a command rather than off the wire.
 *
 * That flag is why `terminal` has no free-standing test. "This looks like
 * terminal output" is exactly the sort of guess the ContentRender header
 * forbids — a wall of prose with two line breaks would satisfy any such test —
 * so terminal is reachable only from a payload we PARSED out of a `stdout`
 * field, or from a human's explicit pin.
 */
export declare function heuristicForm(shape: string, text: string, fromEnvelope: boolean): ContentForm;
/**
 * One line of context from an envelope, drawn as a chip rather than as JSON.
 *
 * A closed union, and deliberately short: every OTHER residual key on an
 * envelope (`path` and `total_lines` on codeReadResult, and whatever the next
 * producer invents) is DROPPED rather than guessed at, and stays reachable
 * through the footer's "the full content is in the trace". A chip line that
 * grows a row per unrecognised key is the raw-JSON problem again with borders.
 */
export type MetaChip = {
    readonly kind: "exit";
    readonly code: number;
} | {
    readonly kind: "stderr";
    readonly text: string;
} | {
    readonly kind: "envelopeShape";
    readonly shape: string;
};
export interface RenderPlan {
    readonly form: ContentForm;
    /** What to draw. NOT always the preview: an unwrapped envelope draws its payload. */
    readonly text: string;
    /** The key a single-key wrapper was carrying its value under. */
    readonly label?: string;
    readonly meta?: readonly MetaChip[];
    /** The `shape` field INSIDE the envelope, when it declared one. */
    readonly envelopeShape?: string;
}
export declare function truncatedEnvelopePayload(preview: string): {
    text: string;
    envelopeShape: string;
} | null;
export declare function planContent(shape: string, preview: string, truncated: boolean, formByShape?: Readonly<Record<string, string>>): RenderPlan;
/**
 * The form alone, for a caller that has no plan to thread. Kept as the narrow
 * public API of this module: a form is derivable from a plan, never the other
 * way round.
 */
export declare function detectForm(shape: string, text: string, override?: Readonly<Record<string, string>>): ContentForm;
export declare function isKnownForm(form: string): form is ContentForm;
/**
 * One table cell. `summarised` is the honest half of the contract: a cell that
 * stands in for a value the table cannot hold must SAY it is standing in, or a
 * reader takes the stand-in for the value.
 */
export interface Cell {
    readonly text: string;
    /** The elided value, for the `title` attribute. Capped — a tooltip is not a viewer. */
    readonly title?: string;
    readonly summarised?: boolean;
}
export interface ParsedRows {
    readonly columns: readonly string[];
    readonly rows: readonly (readonly Cell[])[];
}
export declare function parseRows(text: string): ParsedRows | null;
export type DiffLineKind = "added" | "removed" | "hunk" | "meta" | "context";
export interface DiffLine {
    readonly kind: DiffLineKind;
    readonly text: string;
}
export declare function parseDiff(text: string): readonly DiffLine[];
//# sourceMappingURL=ledger.d.ts.map