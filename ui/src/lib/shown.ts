/**
 * WHAT THE PAGE SHOWED THE PERSON, as a records row they write: the rows on screen, each by its id
 * and shape, measured off the page as drawn. Written under the signed-in person's own key, so records
 * names them as its writer; nothing in the row names them otherwise. Signed out, nothing is written:
 * a row nobody can be named for is not what a person was shown.
 *
 * The row cites nothing in `input_refs` and carries no `r`. Records reads a person's row citing a
 * root as their word on it (a wait it ends) and one with `r` as a grade; being shown a row is
 * neither, so what was shown is its own field, `shown`. It is not an ask either: records takes as
 * asks only the shapes an owner's schema declares.
 */
import { MIN_VISIBLE_FRACTION, SOLICITATION_ATTR, clipChain, visibleFraction, type PresentationConditions, type Rect } from "./exposure";

/**
 * Every row the page draws that a person can act on, each naming its id: a records row (Reports.tsx Rows, data-row)
 * and a row drawn as a question (Reports.tsx Questions, the solicitation id). A row's shape is its data-shape, null
 * where the row names none. An element carrying both ids is one row, named by its data-row.
 *
 * This row is the successor of the browser's exposure tick (exposure-reporter.ts), which writes the same name,
 * "exposure", to this instance's observation journal for importance-learn and form-learn. The tick runs beside this
 * row, measuring question rows only, and retires with its journal and those learners once a reader of these records
 * rows grades what was shown.
 */
export const SHOWN_SELECTOR = `.sf-row[data-row], [${SOLICITATION_ATTR}]`;

/**
 * The fewest milliseconds between two rows from one page. A behaviour constant, named as debt: the
 * cadence belongs in a rhythm the page reads, and until one carries it, this bounds what a page adds
 * to the one store every reader folds over.
 */
export const SHOWN_MIN_MS = 60_000;

export interface Shown {
  readonly id: string;
  readonly shape: string | null;
}

/** The rows at least half on screen inside `root`, in the order drawn, each once. */
export function shownOn(root: ParentNode, viewport: Rect): Shown[] {
  const out: Shown[] = [];
  const seen = new Set<string>();
  for (const el of Array.from(root.querySelectorAll<HTMLElement>(SHOWN_SELECTOR))) {
    const id = el.getAttribute("data-row") ?? el.getAttribute(SOLICITATION_ATTR);
    if (!id || seen.has(id)) continue;
    const box = el.getBoundingClientRect();
    if (visibleFraction({ x: box.x, y: box.y, width: box.width, height: box.height }, [...clipChain(el), viewport]) < MIN_VISIBLE_FRACTION) continue;
    seen.add(id);
    out.push({ id, shape: el.getAttribute("data-shape") });
  }
  return out;
}

/** The row a person writes for what they were shown. */
export function shownRow(shown: readonly Shown[], conditions: PresentationConditions, at: Date, presentation: string | null): Record<string, unknown> {
  return {
    shape: "exposure",
    shown: shown.map((s) => ({ id: s.id, shape: s.shape })),
    at: at.toISOString(),
    viewport: conditions.viewport,
    renderer_bundle: conditions.rendererBundle,
    presentation,
  };
}

/**
 * When a page writes: only for a set of rows it has not written last, and no sooner than SHOWN_MIN_MS
 * after its last row. A change inside that window is written when the window ends, if it still holds.
 */
export class ShownGate {
  private last: string | null = null;
  private lastAt: number | null = null;

  /** "same": nothing new; a number: wait that many ms, then measure again; "write": write it now. */
  check(shown: readonly Shown[], now: number): "same" | "write" | number {
    const key = shown.map((s) => s.id).sort().join("\n");
    if (key === this.last) return "same";
    if (this.lastAt !== null && now - this.lastAt < SHOWN_MIN_MS) return this.lastAt + SHOWN_MIN_MS - now;
    return "write";
  }

  /** The set written, at `now`. */
  wrote(shown: readonly Shown[], now: number): void {
    this.last = shown.map((s) => s.id).sort().join("\n");
    this.lastAt = now;
  }
}
