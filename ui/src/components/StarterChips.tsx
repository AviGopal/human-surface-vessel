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

/**
 * The affordance that says this surface is itself changeable by instruction.
 *
 * It is the one starter not derived from the fleet vocabulary, and the comment
 * in `lib/starters.ts` forbidding a hardcoded starter list is worth answering
 * head-on: that rule exists because a fixed list of CAPABILITY examples goes
 * stale the moment the fleet changes and then advertises things that no longer
 * exist. This chip advertises no fleet capability. It names the surface the
 * reader is already looking at, which cannot go stale while they can see it —
 * and the surface genuinely does read its own render policy at use time, so
 * the instruction is one the system can actually act on.
 *
 * It INSERTS, like every other chip. `StarterChips` has no dispatch mutation
 * in scope at all, so P2 is structural here rather than a promise.
 */
const SELF_STARTER = {
  label: "change this surface",
  text: "Change this surface itself: make the labels on the human surface bigger. Write the new type-scale values as render-policy token overrides, which this page reads at use time — ",
} as const;

function SelfChip({ onInsert }: { onInsert: (text: string) => void }): ReactNode {
  return (
    <button
      type="button"
      className="sf-chip"
      data-kind="self"
      title="This surface can be changed by asking. Fills the box — it does not send."
      onClick={() => onInsert(SELF_STARTER.text)}
    >
      {SELF_STARTER.label}
    </button>
  );
}

function Chip({ starter, onInsert }: { starter: Starter; onInsert: (text: string) => void }): ReactNode {
  // Producer verification REFINES a chip that is already on screen. It never
  // gates the first paint: a surface that waits on N capability lookups before
  // showing a single suggestion has rebuilt the blank box it exists to remove.
  const capability = useCapability(starter.shape, true);

  // THREE states, not two. `capability.data === true` collapsed "the lookup
  // has not answered" into "confirmed absent", so every chip rendered dashed
  // and the legend under them — "a dashed chip has no confirmed producer" —
  // was unfalsifiable: with no solid chip anywhere on screen that sentence
  // carried no information at all. A chip goes dashed only on a confirmed
  // negative; not-yet-known says so, and says it more quietly.
  const producer =
    capability.data === true ? "live" : capability.data === false ? "unverified" : "unknown";

  const TITLE: Record<string, string> = {
    live: `A vessel is advertising ${starter.shape} right now`,
    unverified: `Derived from ${starter.shape}; discovery confirmed no live producer for it`,
    unknown: `Derived from ${starter.shape}; this surface has not been able to check for a producer yet`,
  };

  return (
    <button
      type="button"
      className="sf-chip"
      data-producer={producer}
      title={TITLE[producer]}
      onClick={() => onInsert(starter.text)}
    >
      {starter.label}
    </button>
  );
}

export function StarterChips({ onInsert }: { onInsert: (text: string) => void }): ReactNode {
  const shapes = useFleetShapes();

  // The self chip survives both of the degraded branches below on purpose: it
  // does not depend on the fleet vocabulary, and the state where this surface
  // cannot read the fleet is exactly the state in which "you can change this
  // surface by asking" is most worth knowing.
  if (shapes.isError) {
    return (
      <>
        <p className="sf-note sf-muted" style={{ marginTop: "var(--sf-space-3)" }}>
          The fleet's shape list could not be read, so there are no suggestions — not because the
          system can do nothing, but because this surface cannot currently see what it does. Type
          what you want; the walk does not depend on this list.
        </p>
        <div className="sf-chips">
          <SelfChip onInsert={onInsert} />
        </div>
      </>
    );
  }

  if (!shapes.data) {
    return (
      <>
        <p className="sf-note sf-muted" style={{ marginTop: "var(--sf-space-3)" }}>
          Reading what the fleet can produce…
        </p>
        <div className="sf-chips">
          <SelfChip onInsert={onInsert} />
        </div>
      </>
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
        <SelfChip onInsert={onInsert} />
      </div>
      <p className="sf-note sf-muted" style={{ marginTop: "var(--sf-space-2)" }}>
        Derived from the {shapes.data.length} shapes the fleet is advertising right now · clicking
        fills the box, it does not send · a dashed chip is one discovery confirmed has no producer,
        a faded chip is one this surface could not check · the accented chip changes this page
        itself
      </p>
    </>
  );
}
