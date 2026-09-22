/**
 * The session-scoped reporter: one ledger per page, records posted as they are
 * produced.
 *
 * Kept separate from `exposure.ts` so the measurement and the outcome rules
 * stay pure and directly testable, and so the only impure thing in the path —
 * the POST — has exactly one call site.
 */
import {
  ExposureLedger,
  MEASURED_SELECTOR,
  buildExposureRecord,
  buildOutcomeRecord,
  collectCandidates,
  readConditions,
  visibleSlice,
  type ExposureOutcome,
  type Rect,
} from "./exposure";
import { sendObservation } from "../api/exposure";
import { FormDecisionLedger, buildFormDecisionRecord, type FormDecision } from "./form-decision";

const ledger = new ExposureLedger();
const formLedger = new FormDecisionLedger();
let tickSeq = 0;

/**
 * A form decision, on its way to the corpus.
 *
 * Called from the render path, which is why it is a no-op-safe enqueue rather
 * than a POST: a renderer must not do network I/O per row, and a decision that
 * cost a request would have to be sampled, which would put a silent cap on the
 * evidence. Decisions accumulate and ride out on the next presentation tick,
 * under the same measured conditions the exposure record carries — so a form
 * and the viewport it was drawn into are joinable without another key.
 */
export function recordFormDecision(decision: FormDecision): void {
  formLedger.record(decision);
}

/**
 * Post whatever decisions accumulated, if any.
 *
 * Silence when nothing is pending, deliberately: an empty batch would be a row
 * asserting "the surface made no form decisions", which is a claim about the
 * page rather than an observation of it, and a corpus full of them would drown
 * the real ones.
 */
export function flushFormDecisions(conditions: {
  rendererBundle: string | null;
  presentationVariant: string | null;
}): void {
  const decisions = formLedger.drain();
  if (decisions.length === 0) return;
  sendObservation(buildFormDecisionRecord(decisions, conditions, tickSeq));
}

function viewportRect(win: Window): Rect {
  return { x: 0, y: 0, width: win.innerWidth, height: win.innerHeight };
}

/**
 * One presentation tick: measure what is on screen inside `root` and record it.
 *
 * Called when a snapshot is ACCEPTED for display — first paint and each
 * accepted refresh — never on a timer. A timer would accumulate exposure counts
 * for a page nobody is in front of, and `shown_not_acted` would then mean
 * "time passed" instead of "presented again without an act".
 */
export function reportExposureTick(root: ParentNode, snapshotCount: number, attempt = 0): void {
  if (typeof window === "undefined") return;
  const conditions = readConditions(window);
  // MEASURED, THEN RACED. The presentation variant is adopted from the first
  // renderPolicy read, which can land AFTER the first snapshot of
  // solicitations. Emitting immediately would stamp `presentation_variant:
  // null` on a tick that was in fact rendered under an adopted variant, and a
  // learner comparing variants would silently drop that tick. So the first
  // measurement yields to animation frames while the variant is unreadable —
  // frames, not a wall clock, and bounded: if it never becomes readable the
  // record is emitted with null and `unobservable` says so, which is a stated
  // blind spot rather than a plausible-looking value.
  if (conditions.presentationVariant === null && attempt < 60 && typeof window.requestAnimationFrame === "function") {
    window.requestAnimationFrame(() => reportExposureTick(root, snapshotCount, attempt + 1));
    return;
  }
  const candidates = collectCandidates(root, viewportRect(window));
  const visible = visibleSlice(candidates);
  tickSeq += 1;
  sendObservation(
    buildExposureRecord({
      ...conditions,
      snapshotCount,
      candidates,
      visible,
      tickSeq,
      measuredSelector: MEASURED_SELECTOR,
    }),
  );
  // Only ids actually in the visible slice enter the ledger. An id that was
  // never shown produces no record — absence of evidence, not a negative.
  for (const event of ledger.tick(visible.map((item) => item.solicitation_id))) {
    sendObservation(buildOutcomeRecord(event, conditions));
  }
  // AFTER the exposure record, and on the same tick's conditions. Order matters
  // for the same reason it matters in the learner's own corroboration rule:
  // measure the screen first, then report what was decided for it.
  flushFormDecisions(conditions);
}

/** A human act on a solicitation: answered, declined, or complained about. */
export function reportExposureAct(
  solicitationId: string,
  outcome: Exclude<ExposureOutcome, "shown_not_acted">,
  askId?: string | null,
): void {
  if (typeof window === "undefined") return;
  sendObservation(buildOutcomeRecord(ledger.act(solicitationId, outcome, askId), readConditions(window)));
}
