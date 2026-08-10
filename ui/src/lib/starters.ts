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
 *
 * ── Two rules this file learned the hard way ────────────────────────────────
 *
 * 1. FAMILY MATCHING RUNS ON THE HUMANIZED NAME, WITH WORD BOUNDARIES.
 *    Matching `/patch/` against the raw shape name ranked `activeDispatches`,
 *    `goalDispatchAsync` and `light_dispatch_execution` as the top "change a
 *    file" suggestions, because `dispatch` contains `patch`. A substring test
 *    against a machine identifier will eventually match a word that is not
 *    there. `humanizeShape` already splits camelCase and snake_case into words,
 *    so matching `\bpatch\b` on its output is both correct and uniform across
 *    both naming conventions.
 *
 * 2. RANK AND PHRASING COME FROM ONE TABLE, NOT TWO PARALLEL REGEX LISTS.
 *    They used to be separate functions with separately maintained patterns,
 *    which meant a shape could be ranked into one family and phrased as
 *    another — the ordering promised something the chip text did not deliver.
 *    `FAMILIES` below is the single source: position in the array IS the rank.
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
 * STRUCTURAL exclusions — tested against the RAW shape name.
 *
 * These are deliberately not humanized: `_write$` is a suffix on the machine
 * identifier, and humanizing it to "… write" would both lose the anchor and
 * start matching any shape whose last word happens to be "write".
 *
 * `_write` and friends are parameter-rooted ACTION shapes — goal-host itself
 * refuses to treat them as walk targets, because they name a side effect
 * rather than a thing to produce. Offering one as a starter suggests a goal the
 * system will reject.
 */
const NOT_A_GOAL_TARGET =
  /(_write$|_delete$|_update$|_deprecate$|^obsidian:|^fs_|^goal$|^dispatch_id$|^activity_execution$|^goal_execution$|heartbeat|^human_input$|_result$|^parameter|^task_|^error$)/i;

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
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * SEMANTIC exclusions — the fleet's own plumbing, tested on the humanized name.
 *
 * These shapes are real, live, and correctly advertised; they are simply not
 * things a person sits down at this surface to ask for. `interactor event`,
 * `llm quota state` and `federation probe` are how the machine talks to itself.
 *
 * They are DROPPED rather than ranked last, and the difference matters when the
 * fleet vocabulary is small: this surface's own local registry advertises 16
 * shapes and every one of them is plumbing, so "rank last" would still fill all
 * seven chips with them the moment the wider fleet became unreadable. An empty
 * chip row that says why is honest; seven chips offering `interactor assertion`
 * is not.
 *
 * Note `render policy` is excluded here only as a DERIVED chip — the surface's
 * own render policy is what the dedicated "change this surface" chip in
 * `StarterChips` is for, and that chip states the capability directly.
 */
const PLUMBING =
  /\b(interactor|federation|probe|llm|quota|render policy|surface intent|ui feedback|ui panel|ui question|bootstrap|liveness|handshake|registry|discovery|manifest|env|schema)\b/;

interface Family {
  /** Matched against the humanized shape name. */
  readonly test: RegExp;
  /** Fixed chip label, or a function of the humanized name. */
  readonly label: string | ((human: string) => string);
  /** Chip text, or a function of the humanized name. */
  readonly text: string | ((human: string) => string);
}

/**
 * Families a person is most likely to want, most-wanted first. Position IS the
 * rank; within a family, ties break alphabetically so chips never reshuffle
 * between polls.
 *
 * Phrasing is specific rather than categorical — "show me what the substrate
 * holds about reach grading" beats "query the concept graph" — and every
 * phrasing asks for the artifact IN FULL. This surface's recurring failure mode
 * is a run that reports having done something instead of showing it, so the
 * starter text is the first place to refuse a summary.
 */
const FAMILIES: readonly Family[] = [
  {
    test: /\bgaps?\b/,
    label: "open gaps",
    text: "List the gaps that are currently open, with the reason each was filed, and tell me which one is blocking the most other work.",
  },
  {
    test: /\b(answers?|questions?)\b/,
    label: "ask a question",
    text: "Answer this about the running substrate, citing what you actually read: ",
  },
  {
    test: /\b(diffs?|patch|patches|code change|code modification|edit)\b/,
    label: "change a file",
    text: "Change one named file under repos/<vessel>/src/ and show me the diff you landed. Describe the change in the sentence below and name the file explicitly: ",
  },
  {
    test: /\b(shell|bash|command|exec)\b/,
    label: "run a check",
    text: "Run a check against the running substrate and show me its complete output, not a summary: ",
  },
  {
    test: /\b(tests?|typecheck|lint|verify|verification|verified)\b/,
    label: "verify",
    text: "Run the verification for one vessel and show me every failure in full, not the count: ",
  },
  {
    test: /\b(reports?|audits?|assessments?)\b/,
    label: (h) => h,
    text: (h) =>
      `Produce a ${h} for the substrate as it stands right now, and show me the evidence each conclusion rests on.`,
  },
  {
    test: /\b(traces?|executions?|runs?|dispatches?)\b/,
    label: "inspect a run",
    text: "Find the most recent run that completed without reaching its goal and tell me what it actually produced.",
  },
  {
    test: /\bconcepts?\b/,
    label: "search concepts",
    text: "Search the concept graph and show me, in full, what the substrate holds about ",
  },
  {
    test: /\bmemory|memories|notes?\b/,
    label: "recall memory",
    text: "Recall what you already know about ",
  },
  {
    test: /\b(metrics?|posterior|thompson|learning|scores?)\b/,
    label: (h) => h,
    text: (h) => `Show me the current ${h}, and say which of those numbers is measured and which is derived.`,
  },
  {
    test: /\b(spec|specs|proposals?|docs?|documentation)\b/,
    label: (h) => h,
    text: (h) => `Draft a ${h} for this, and state the expectation it is committing the system to: `,
  },
  {
    test: /\b(code|function|import|symbol|file)\b/,
    label: "read code",
    text: "Find where this is implemented and show me the actual lines, with the file path: ",
  },
];

/** Index into FAMILIES, or FAMILIES.length for "no family matched". */
function familyIndexOf(human: string): number {
  const i = FAMILIES.findIndex((f) => f.test.test(human));
  return i === -1 ? FAMILIES.length : i;
}

function phraseFor(human: string): { label: string; text: string } {
  const family = FAMILIES[familyIndexOf(human)];
  if (family === undefined) {
    // Unrecognised family: still produce a usable sentence rather than dropping
    // the shape, so a vocabulary nobody anticipated degrades to something a
    // person can read and edit.
    return {
      label: human,
      text: `Produce a ${human} and show me its full contents, not a description of it: `,
    };
  }
  return {
    label: typeof family.label === "function" ? family.label(human) : family.label,
    text: typeof family.text === "function" ? family.text(human) : family.text,
  };
}

/** Exported for the derivation test harness and for `inferTargetShapes`. */
export function isHumanGoalTarget(shape: string): boolean {
  if (!isWellFormedShapeName(shape)) return false;
  if (NOT_A_GOAL_TARGET.test(shape)) return false;
  if (PLUMBING.test(humanizeShape(shape))) return false;
  return true;
}

export function deriveStarters(shapes: readonly string[], limit: number): readonly Starter[] {
  const eligible = shapes.filter(isHumanGoalTarget);

  // Collapse naming-convention duplicates BEFORE ranking. `gitDiff` and
  // `git_diff` are two registry entries for one idea, and `llmCompletion` /
  // `llm_completion` likewise; humanizing them yields the same words, so the
  // humanized form is the natural identity. Keeping the lexicographically
  // smallest raw name makes the choice deterministic rather than dependent on
  // registry order.
  const byHuman = new Map<string, string>();
  for (const shape of eligible) {
    const human = humanizeShape(shape);
    const held = byHuman.get(human);
    if (held === undefined || shape < held) byHuman.set(human, shape);
  }

  const sorted = [...byHuman.values()].sort((a, b) => {
    const ra = familyIndexOf(humanizeShape(a));
    const rb = familyIndexOf(humanizeShape(b));
    if (ra !== rb) return ra - rb;
    // Unique tiebreaker: shape names are unique in the registry.
    return a < b ? -1 : a > b ? 1 : 0;
  });

  // ONE CHIP PER FAMILY, not one per label.
  //
  // Deduping by label alone let a single family occupy several of the seven
  // slots whenever its label was derived from the shape name: the live fleet
  // advertises five distinct report shapes, so `template audit report` and
  // `trace aggregate report` took two slots between them and pushed whole
  // families — concepts, code — off the row entirely. Seven chips drawn from
  // seven different families tell a person far more about what this system can
  // do than seven variations on one.
  //
  // Because `sorted` is family-ranked then alphabetical, the survivor of each
  // family is deterministic: the alphabetically first shape in the most-wanted
  // family available.
  const seenFamilies = new Set<number>();
  const seenLabels = new Set<string>();
  const out: Starter[] = [];
  for (const shape of sorted) {
    if (out.length >= limit) break;
    const human = humanizeShape(shape);
    const family = familyIndexOf(human);
    if (seenFamilies.has(family)) continue;
    const { label, text } = phraseFor(human);
    if (seenLabels.has(label)) continue;
    seenFamilies.add(family);
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
