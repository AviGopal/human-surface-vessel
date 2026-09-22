/**
 * THE FORM DECISION, RECORDED SO IT CAN BE GRADED.
 *
 * Today the surface decides how to draw every impulse and records nothing about
 * having decided. That is the reason no tier of the rendering design can learn
 * yet — not the absence of a learner, and not the absence of Jev. A reward
 * signal needs a decision to attach itself to, and until this file existed
 * there was no row anywhere in the system saying "this shape, this content, was
 * drawn this way, by this branch, under this policy". The importance learner hit
 * exactly this wall from the other side: its weights had no evidence source
 * until the exposure record was built.
 *
 * WHAT MAKES A DECISION JOINABLE. Four fields, and each is load-bearing:
 *
 *   • `shape` — what a pin is keyed on, so a learned disposition can be written
 *     back to the same key a human's instruction uses.
 *   • `content_signature` — what makes two renders of the SAME bytes one
 *     observation rather than two. Keyed on the content, not the shape, because
 *     the open vocabulary means one shape carries wildly different content and
 *     "shape X renders badly" is usually "shape X's 74KB variant renders badly".
 *   • `decided_by` — which branch chose. Without it a pin and a guess of last
 *     resort are the same row, and the heuristic takes credit for the human's
 *     instruction. This is the field that makes the record a decision rather
 *     than a description.
 *   • `policy_revision` — which `renderPolicy` was in force. A complaint that
 *     cannot be joined to the policy it was made under cannot be attributed,
 *     and the surface changes its own policy at runtime by design.
 *
 * WHAT THIS DELIBERATELY DOES NOT CARRY. The content itself, ever. A 74KB
 * preview is not evidence a learner needs and shipping it back would turn an
 * observation channel into a data-exfiltration path for whatever an impulse
 * happened to hold. The signature is a hash plus a length: enough to tell two
 * payloads apart, not enough to reconstruct either.
 *
 * AND IT IS NOT A JUDGEMENT. Nothing here says a form was right. It says a
 * choice was made and names its author, which is the prerequisite for a
 * judgement arriving later from a human's pin, a complaint, or a fidelity
 * predicate. A record that scored itself would be the self-confirming oracle
 * the legibility scan's header warns about.
 */

import type { ContentForm } from "@avigopal/design-tokens";
import { MACHINE_ORIGIN } from "./exposure";
import type { FormDecisionSource } from "./ledger";

/**
 * FNV-1a, 32-bit, hex. Chosen because it is four lines of dependency-free
 * arithmetic and the requirement is distinguishability, not cryptographic
 * strength — two different payloads must land on different keys often enough
 * that a learner is not silently folding them together.
 *
 * Length is carried ALONGSIDE the hash rather than folded into it so a reader
 * can see the size of the thing that was drawn without another join. A
 * collision that also matches on length is possible and is the stated limit of
 * this identity; nothing downstream treats the signature as a proof of equality.
 */
export function contentSignature(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    // 16777619, as shifts — Math.imul keeps this in 32-bit territory rather
    // than drifting into float mantissa territory on long payloads.
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv1a32:${hash.toString(16).padStart(8, "0")}:${text.length}`;
}

export interface FormDecision {
  readonly shape: string;
  readonly content_signature: string;
  readonly form: ContentForm;
  readonly decided_by: FormDecisionSource;
  readonly policy_revision: number | null;
  /** Characters of content the plan actually drew — not the envelope around it. */
  readonly drawn_chars: number;
  /** True when the plan was made from a preview the producer had already cut. */
  readonly truncated: boolean;
  /**
   * Whether the drawn text is a single line.
   *
   * Recorded because the CENSUS CANNOT DERIVE IT. The server sees only a hash
   * and a length, so a short multi-line payload and a short single-line one are
   * indistinguishable to it — and the census's misroute bucket ("a value drawn
   * as a code listing") is only about the single-line case. Without this field
   * the bucket counts a correctly-verbatim two-line `git_status` as a misroute,
   * and once a detector files gaps from that bucket it becomes a
   * false-positive generator wired to the gap store.
   */
  readonly single_line: boolean;
  /** Where on the surface it was drawn. A question card and a ledger row are different reads. */
  readonly region: string;
}

/**
 * The composite-key separator, written as an ESCAPE and not as a raw byte.
 *
 * NUL is the right separator — it cannot occur in a shape name, a signature, a
 * form, or a region, so no pair of distinct keys can collide by concatenation.
 * But a RAW NUL in a source file makes that file binary to git and invisible to
 * grep, which this repository has already paid for once: eight vessel sources
 * were silently unsearchable because a raw NUL was used exactly this way. The
 * escape gives the same byte at runtime and keeps the file text.
 */
const KEY_SEP = "\u0000";

/** The key two identical decisions collapse onto. */
function keyOf(d: FormDecision): string {
  return `${d.shape}${KEY_SEP}${d.content_signature}${KEY_SEP}${d.form}${KEY_SEP}${d.decided_by}${KEY_SEP}${String(d.policy_revision)}${KEY_SEP}${d.region}`;
}

/**
 * Session-scoped dedupe.
 *
 * React re-renders a component many times for one presentation, and a decision
 * recorded once per paint would make `decided_by: "rescue"` look a hundred
 * times more frequent than a pin a person set once — a repetition artifact
 * masquerading as evidence. The same defect the importance learner had to fix
 * on its own input, caught here before it reaches a corpus.
 *
 * The key includes `policy_revision`, so the SAME content re-decided after a
 * policy change is a new decision. That is the observation a comparison needs.
 */
export class FormDecisionLedger {
  private readonly seen = new Set<string>();
  private pending: FormDecision[] = [];

  /** Returns true when this decision was new. */
  record(decision: FormDecision): boolean {
    const key = keyOf(decision);
    if (this.seen.has(key)) return false;
    this.seen.add(key);
    this.pending.push(decision);
    return true;
  }

  /** Hand over everything recorded since the last drain. */
  drain(): readonly FormDecision[] {
    const out = this.pending;
    this.pending = [];
    return out;
  }

  get pendingCount(): number {
    return this.pending.length;
  }
}

export interface FormDecisionConditions {
  readonly rendererBundle: string | null;
  readonly presentationVariant: string | null;
}

/**
 * The `interactorObservation` pointer for a batch of decisions.
 *
 * ONE SHAPE, REUSED — the same argument `api/exposure.ts` makes for the
 * exposure tick: `interactorObservation` is an unconstrained append-only
 * observation channel this vessel already advertises and serves, and minting a
 * `uiFormDecision` shape would split the observation channel for no capability
 * it cannot already express (law 3).
 *
 * `claim` states in words what the record does and does not assert, so a reader
 * who finds this row without this file cannot mistake it for a quality signal.
 */
export function buildFormDecisionRecord(
  decisions: readonly FormDecision[],
  conditions: FormDecisionConditions,
  tickSeq: number,
): Record<string, unknown> {
  return {
    type: "interactorObservation",
    obs_type: "form_decision",
    /*
     * THE SAME MARKER THE EXPOSURE RECORDS USE, imported rather than retyped.
     *
     * This said "browser" until the importance loop probe refused it: that
     * probe asserts EVERY record the page posts is machine-origin, which is
     * what keeps a machine-written observation from ever being counted as a
     * human contribution — 48 machine records once polluted the operator-verdict
     * corpus and manufactured a false reach class. A second spelling of the
     * marker would have made the guard pass for the records that happened to use
     * the old word and silently not cover these.
     */
    origin: MACHINE_ORIGIN,
    producer: "human-surface-vessel/ui/form-decision",
    tick_seq: tickSeq,
    decisions,
    decisions_count: decisions.length,
    renderer_bundle: conditions.rendererBundle,
    presentation_variant: conditions.presentationVariant,
    claim:
      "Each row records that this surface CHOSE a content form for a payload, and which branch chose it. " +
      "It asserts nothing about whether the form was the right one — no human judged these, and no " +
      "fidelity predicate was evaluated. The content itself is not carried; the signature is a hash and a length.",
  };
}
