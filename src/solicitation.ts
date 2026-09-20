/**
 * The single predicate for "does this panel ask a human for something?".
 *
 * WHY THIS IS ITS OWN MODULE, and not left in store.ts where it was born: the
 * ranking work made `store.ts` depend on `importance.ts` (the render policy now
 * carries `importanceWeights`, whose default is `DEFAULT_IMPORTANCE_WEIGHTS`,
 * read while the store's initial policy literal is being built), while
 * `importance.ts` already depended on `store.ts` for this predicate. That is a
 * runtime import cycle, and it is not benign: measured on bun 1.3.9, loading
 * `importance.ts` first (which is exactly what `test/importance.test.ts` does)
 * leaves `DEFAULT_IMPORTANCE_WEIGHTS` in its temporal dead zone while store.ts's
 * module body runs, and the store throws
 * `ReferenceError: Cannot access 'DEF' before initialization` at import. A cycle
 * broken by luck of load order is a latent crash, so the shared leaf moved down
 * here instead. `store.ts` re-exports it, so every existing importer is
 * unchanged and there is still exactly ONE definition — the property that
 * mattered when three re-derived copies of this rule diverged.
 */

/**
 * Kinds that are purely informational — a panel the substrate is TELLING a human,
 * with nothing being asked of them. Everything else solicits.
 */
const INFORMATIONAL_KINDS: ReadonlySet<string> = new Set(["info", "pulse"]);

/**
 * Does this panel ask a human for something?
 *
 * DENYLIST, fail-visible, deliberately. An allowlist has already failed twice in
 * production here, and it cannot not fail: the kind vocabulary is OPEN at
 * runtime — the write path stores an unrecognised kind uncoerced (a probe wrote
 * `escalation_kind_nobody_invented_yet` and it persisted at revision 1), and the
 * escalation kinds that exist live (`gap_needs_human`, `gap_pending_verification`,
 * `gap_needs_localization`, `gap_reland_needs_human`, `question`) were each
 * minted by a caller, not by this file. Any new escalation kind a resolver
 * invents is therefore invisible under an allowlist, and invisible means the
 * human is never asked.
 *
 * "Has asks" is not the predicate either: the live escalation panels carry ZERO
 * asks (development-vessel's gap-to-feature.ts emits title/body/kind/importance
 * only), so keying on asks would surface 3 of 445 live panels.
 *
 * The only genuinely choosable thing here is the failure polarity, and it is not
 * symmetric: a human can dismiss noise, and cannot see silence.
 *
 * Read by store.ts's `recordFeedback` (the answer guard) and `signatureInputs`
 * (the open-age metric), routes/impulses.ts's `uiQuestion` reader, and
 * importance.ts's `scorePanel` (the unanswered boost is only a fact about a
 * panel that asked something).
 */
export function isSolicitation(panel: { readonly kind: string }): boolean {
  return !INFORMATIONAL_KINDS.has(panel.kind);
}
