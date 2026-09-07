/**
 * A mid-walk question is answered WHERE THE RUN IS.
 *
 * The failure this prevents is two half-surfaces: a question on one screen, the
 * run it belongs to on another, and the correlation work falling to the human.
 *
 * HONEST LIMITATION, stated in the UI as well as here: `goalWalkState` does not
 * carry pending solicitations. `poolEvents` is `{shape, source, at}` and
 * nothing else, and the `human_input` impulse that holds the question text and
 * its `solicitation_id` is posted to a separate sink vessel rather than
 * mirrored onto the dispatch record. So the walk log is the only signal here,
 * and when it names a question without its id, this panel says so rather than
 * guessing an id and posting an answer into nowhere.
 */
import { type ReactNode } from "react";
import type { DetectedSolicitation } from "../lib/walk";
export declare function SolicitationPanel({ solicitation, }: {
    solicitation: DetectedSolicitation;
}): ReactNode;
//# sourceMappingURL=SolicitationPanel.d.ts.map