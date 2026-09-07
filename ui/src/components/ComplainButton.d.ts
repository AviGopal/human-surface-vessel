/**
 * The human half of the one funnel.
 *
 * The substrate's `ui_legibility_scan` files findings about this surface keyed
 * `ui-feedback-<region>-<kind>`. This control files a human's complaint into the
 * SAME keyspace, differing only in `source: human_reported`. That shared key is
 * the point: it is what lets "the detector found it and nobody complained" and
 * "people complained and the detector was silent" both be computed, and those
 * two questions are the only evidence about whether the detector's rules match
 * what people actually notice.
 *
 * The complaint appears in the gap strip within one poll. It is never
 * auto-closed by the detector — a detector may close its own findings on
 * re-observation, but closing a human's report because its three rules pass
 * would be asserting that the human saw nothing.
 */
import { type ReactNode } from "react";
export declare function ComplainButton({ region }: {
    region: string;
}): ReactNode;
//# sourceMappingURL=ComplainButton.d.ts.map