/**
 * Rule P2: a starter INSERTS and FOCUSES. It never dispatches.
 *
 * There is no dispatch mutation reachable from this component — it is not
 * imported, not passed in, and could not be called from here. That is
 * deliberate and it is the checkable form of the rule.
 *
 * The failure it prevents is not the blank canvas (the chips fix that); it is
 * auto-execution. Clicking a suggestion that immediately runs removes the one
 * moment a person could have corrected the guess — and a suggestion is a guess.
 * The insert leaves the cursor at the end of the inserted text so the obvious
 * next act is finishing the sentence.
 */
import type { ReactNode } from "react";
export declare function StarterChips({ onInsert }: {
    onInsert: (text: string) => void;
}): ReactNode;
//# sourceMappingURL=StarterChips.d.ts.map