/**
 * The run contract, shown on submit — not before.
 *
 * Long runs need a contract, breadcrumbs, and a salvage path. What this states
 * is: the shapes the walk is likely aiming at, roughly how long this class of
 * work takes, and what it will come back and ASK about rather than decide on
 * its own.
 *
 * THE STANDING OMISSION: no confidence number appears here or anywhere else in
 * this surface. Planner confidence in this system is measurably uncalibrated —
 * runs dispatched at confidence 0.0 outperform runs at 0.9 — so a percentage
 * would launder a known-bad signal into something that reads as measurement.
 * A duration BAND is honest about its own width in a way a point estimate is
 * not, and it is labelled with where it came from.
 */

export interface RunContract {
  readonly targetShapes: readonly string[];
  readonly lowSec: number;
  readonly highSec: number;
  /** Where the band came from. Stated, so it cannot be mistaken for a measurement. */
  readonly bandBasis: string;
  /** What the walk will come back and ask about instead of deciding alone. */
  readonly willAskAbout: readonly string[];
  readonly klass: string;
}

const NAMES_A_SOURCE_FILE = /repos\/[\w.-]+\/src\/[\w./-]+/;

export function buildContract(goal: string, inferredShapes: readonly string[]): RunContract {
  const g = goal.toLowerCase();

  if (NAMES_A_SOURCE_FILE.test(goal)) {
    return {
      targetShapes: inferredShapes,
      lowSec: 90,
      highSec: 420,
      bandBasis:
        "a band for code-editing work, taken from the class of run rather than from this goal — no measured history is claimed",
      willAskAbout: [
        "which region of the file to replace, if the description matches more than one",
        "whether to proceed when the typecheck fails after the edit",
      ],
      klass: "a code change — it will draft, typecheck, and land a traced commit",
    };
  }

  if (/\b(list|show|what|which|how many|count|find|tell me|explain|why)\b/.test(g)) {
    return {
      targetShapes: inferredShapes,
      lowSec: 20,
      highSec: 150,
      bandBasis: "a band for read-and-answer work, taken from the class of run — not a measured estimate",
      willAskAbout: ["which substrate to read from, if more than one could answer"],
      klass: "a question — it will read, then answer with what it actually read",
    };
  }

  if (/\b(audit|report|assess|review|analyse|analyze)\b/.test(g)) {
    return {
      targetShapes: inferredShapes,
      lowSec: 60,
      highSec: 600,
      bandBasis: "a band for analysis work, taken from the class of run — not a measured estimate",
      willAskAbout: [
        "how wide to cast the analysis, if the scope is open",
        "whether a partial answer is worth returning early",
      ],
      klass: "an analysis — it will gather evidence before concluding",
    };
  }

  return {
    targetShapes: inferredShapes,
    lowSec: 30,
    highSec: 300,
    bandBasis: "a wide band, because the class of this goal was not recognised — not a measured estimate",
    willAskAbout: ["anything it cannot infer from the goal text alone"],
    klass: "a general goal — it will walk the shape graph toward the targets below",
  };
}
