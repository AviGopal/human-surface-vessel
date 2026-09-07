/**
 * Rule P9, and it is the single most important renderer in this surface.
 *
 * The shape vocabulary is OPEN — hundreds of shapes, learned by observation
 * rather than declared, and ragged enough that whole prose sentences have been
 * registered as shape names. No renderer-per-shape is possible. Content,
 * however, arrives in a small CLOSED set of forms.
 *
 * So: dispatch on the form, and make the verbatim branch the DEFAULT. That
 * default is the designed common case, not an error state — most shapes will
 * never earn a bespoke renderer and do not need one. A surface that renders
 * blank for the shapes nobody anticipated has failed at exactly the moment it
 * mattered, and one that pretty-prints something it misidentified has failed
 * worse.
 *
 * Which is the whole design of the three forms added below. `terminal`,
 * `record` and `scalar` fire only on POSITIVE evidence assembled in
 * `planContent` — a full successful `JSON.parse` of a NON-truncated preview —
 * and every one of them falls back to verbatim rather than draw a value it
 * could not confirm. A truncated fragment never reaches them at all.
 */
import { type ReactNode } from "react";
import { type RenderPlan } from "../lib/ledger";
export declare function ContentRender({ plan }: {
    plan: RenderPlan;
}): ReactNode;
//# sourceMappingURL=ContentRender.d.ts.map