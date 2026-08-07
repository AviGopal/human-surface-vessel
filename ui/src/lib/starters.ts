/**
 * Starters, derived from the LIVE shape vocabulary at render time.
 *
 * There is no hardcoded starter array in this file and there must never be
 * one. The blank box is the bug: a person facing an empty textarea with no
 * indication of what the system can actually do will either ask for something
 * it cannot do, or ask for nothing. But a fixed list of examples is the same
 * bug wearing a coat — it goes stale the moment the fleet changes, and then it
 * advertises capabilities that no longer exist.
 *
 * So: take the shapes discovery is advertising right now, throw out the ones
 * that cannot be the TARGET of a human goal, and phrase what is left as a
 * concrete task. Ranking and phrasing are deterministic, so the chips do not
 * reshuffle between renders.
 */

export interface Starter {
  /** Stable key — the shape it was derived from. Never an array index. */
  readonly id: string;
  readonly shape: string;
  /** Short chip label. */
  readonly label: string;
  /** What gets INSERTED into the input. Clicking never dispatches (rule P2). */
  readonly text: string;
  /**
   * null while the producer lookup is still in flight. The chip renders
   * immediately either way — capability enrichment refines a chip that is
   * already on screen, it never gates the first paint.
   */
  readonly hasProducer: boolean | null;
}

/**
 * Shapes that exist but cannot sensibly be a human's goal.
 *
 * `_write` and friends are parameter-rooted ACTION shapes — goal-host itself
 * refuses to treat them as walk targets, because they name a side effect
 * rather than a thing to produce. Offering one as a starter suggests a goal the
 * system will reject.
 */
const NOT_A_GOAL_TARGET =
  /(_write$|^obsidian:|^fs_|^goal$|^dispatch_id$|^activity_execution$|^goal_execution$|heartbeat|^human_input$|_result$|^parameter|^task_|^error$)/i;

/** The vocabulary is ragged: whole prose sentences have been registered as shape names. */
function isWellFormedShapeName(shape: string): boolean {
  if (shape.length === 0 || shape.length > 44) return false;
  if (/\s/.test(shape)) return false;
  if (!/^[A-Za-z][A-Za-z0-9_:.-]*$/.test(shape)) return false;
  return true;
}

export function humanizeShape(shape: string): string {
  return shape
    .replace(/^[a-z]+:/, "")
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .trim();
}

/**
 * Phrase a shape as something a person would actually ask for.
 *
 * Specific rather than categorical: "show me the concepts the substrate holds
 * about reach grading" beats "query the concept graph". The phrasing is derived
 * from the shape family, so a shape nobody anticipated still produces a usable
 * sentence rather than being dropped.
 */
function phrase(shape: string): { label: string; text: string } {
  const human = humanizeShape(shape);

  if (/diff|patch|codeChange/i.test(shape)) {
    return {
      label: `change a file`,
      text: `Change one named file under repos/<vessel>/src/ and show me the diff you landed. Describe the change in the sentence below and name the file explicitly: `,
    };
  }
  if (/^memoryNote/i.test(shape) || /memory/i.test(shape)) {
    return {
      label: `recall memory`,
      text: `Recall what you already know about `,
    };
  }
  if (/concept/i.test(shape)) {
    return {
      label: `search concepts`,
      text: `Search the concept graph and show me, in full, what the substrate holds about `,
    };
  }
  if (/gap/i.test(shape)) {
    return {
      label: `open gaps`,
      text: `List the gaps that are currently open, with the reason each was filed, and tell me which one is blocking the most other work.`,
    };
  }
  if (/shell|command|exec/i.test(shape)) {
    return {
      label: `run a check`,
      text: `Run a check against the running substrate and show me its complete output, not a summary: `,
    };
  }
  if (/(report|audit|assessment)$/i.test(shape)) {
    return {
      label: human,
      text: `Produce a ${human} for the substrate as it stands right now, and show me the evidence each conclusion rests on.`,
    };
  }
  if (/(summary|answer)$/i.test(shape) || /^goal_answer$/.test(shape)) {
    return {
      label: `ask a question`,
      text: `Answer this about the running substrate, citing what you actually read: `,
    };
  }
  if (/(trace|execution)/i.test(shape)) {
    return {
      label: `inspect a run`,
      text: `Find the most recent run that completed without reaching its goal and tell me what it actually produced.`,
    };
  }
  if (/(test|typecheck|lint|verif)/i.test(shape)) {
    return {
      label: `verify`,
      text: `Run the verification for one vessel and show me every failure in full, not the count: `,
    };
  }
  if (/(metric|posterior|thompson|learning)/i.test(shape)) {
    return {
      label: human,
      text: `Show me the current ${human}, and say which of those numbers is measured and which is derived.`,
    };
  }
  if (/(spec|proposal|doc)/i.test(shape)) {
    return {
      label: human,
      text: `Draft a ${human} for this, and state the expectation it is committing the system to: `,
    };
  }
  return {
    label: human,
    text: `Produce a ${human} and show me its full contents, not a description of it: `,
  };
}

/**
 * Deterministic rank. Families a person is more likely to want come first;
 * within a family, alphabetical, so the chips never reshuffle between polls.
 */
function rank(shape: string): number {
  if (/diff|patch|codeChange/i.test(shape)) return 0;
  if (/^goal_answer$|answer$/i.test(shape)) return 1;
  if (/gap/i.test(shape)) return 2;
  if (/(report|audit)$/i.test(shape)) return 3;
  if (/concept/i.test(shape)) return 4;
  if (/memory/i.test(shape)) return 5;
  if (/(test|typecheck|verif)/i.test(shape)) return 6;
  if (/(trace|execution)/i.test(shape)) return 7;
  if (/(metric|learning)/i.test(shape)) return 8;
  return 9;
}

export function deriveStarters(shapes: readonly string[], limit: number): readonly Starter[] {
  const eligible = shapes.filter((s) => isWellFormedShapeName(s) && !NOT_A_GOAL_TARGET.test(s));

  const sorted = [...eligible].sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    // Unique tiebreaker: shape names are unique in the registry.
    return a < b ? -1 : a > b ? 1 : 0;
  });

  const seenLabels = new Set<string>();
  const out: Starter[] = [];
  for (const shape of sorted) {
    if (out.length >= limit) break;
    const { label, text } = phrase(shape);
    // One chip per phrasing: eight shapes in the same family would otherwise
    // produce eight identical suggestions.
    if (seenLabels.has(label)) continue;
    seenLabels.add(label);
    out.push({ id: shape, shape, label, text, hasProducer: null });
  }
  return out;
}

/**
 * Infer which shapes a goal is likely aiming at, from the live vocabulary.
 * Used for the run contract — stated as an inference, never as a promise.
 */
export function inferTargetShapes(goal: string, shapes: readonly string[], limit = 3): readonly string[] {
  const tokens = goal
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 3);
  if (tokens.length === 0) return [];

  const scored = shapes
    .filter((s) => isWellFormedShapeName(s))
    .map((shape) => {
      const human = humanizeShape(shape);
      const words = human.split(" ");
      let score = 0;
      for (const token of tokens) {
        for (const word of words) {
          if (word === token) score += 3;
          else if (word.length > 3 && (word.startsWith(token) || token.startsWith(word))) score += 1;
        }
      }
      return { shape, score };
    })
    .filter((s) => s.score > 0);

  scored.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    // Unique tiebreaker.
    return a.shape < b.shape ? -1 : a.shape > b.shape ? 1 : 0;
  });

  return scored.slice(0, limit).map((s) => s.shape);
}
