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
import { useCapability, useFleetShapes } from "../api/queries";
import { deriveStarters, type Starter } from "../lib/starters";

const CHIP_LIMIT = 7;

function Chip({ starter, onInsert }: { starter: Starter; onInsert: (text: string) => void }): ReactNode {
  // Producer verification REFINES a chip that is already on screen. It never
  // gates the first paint: a surface that waits on N capability lookups before
  // showing a single suggestion has rebuilt the blank box it exists to remove.
  const capability = useCapability(starter.shape, true);
  const verified = capability.data === true;

  return (
    <button
      type="button"
      className="sf-chip"
      data-producer={verified ? "live" : "unverified"}
      title={
        verified
          ? `A vessel is advertising ${starter.shape} right now`
          : `Derived from ${starter.shape}; no live producer confirmed yet`
      }
      onClick={() => onInsert(starter.text)}
    >
      {starter.label}
    </button>
  );
}

export function StarterChips({ onInsert }: { onInsert: (text: string) => void }): ReactNode {
  const shapes = useFleetShapes();

  if (shapes.isError) {
    return (
      <p className="sf-note sf-muted" style={{ marginTop: "var(--sf-space-3)" }}>
        The fleet's shape list could not be read, so there are no suggestions — not because the
        system can do nothing, but because this surface cannot currently see what it does. Type what
        you want; the walk does not depend on this list.
      </p>
    );
  }

  if (!shapes.data) {
    return (
      <p className="sf-note sf-muted" style={{ marginTop: "var(--sf-space-3)" }}>
        Reading what the fleet can produce…
      </p>
    );
  }

  const starters = deriveStarters(shapes.data, CHIP_LIMIT);

  return (
    <>
      <div className="sf-chips">
        {starters.map((starter) => (
          // P4: keyed on the shape it was derived from, which is unique in the
          // registry. Never the position in the list.
          <Chip key={starter.id} starter={starter} onInsert={onInsert} />
        ))}
      </div>
      <p className="sf-note sf-muted" style={{ marginTop: "var(--sf-space-2)" }}>
        Derived from the {shapes.data.length} shapes the fleet is advertising right now · clicking
        fills the box, it does not send · a dashed chip has no confirmed producer
      </p>
    </>
  );
}
