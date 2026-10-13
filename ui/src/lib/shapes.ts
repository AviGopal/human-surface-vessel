/**
 * A write shape is an ACTION (write a note, edit a file, write a panel), not data.
 * A person can supply data a walk is missing; they cannot "provide" an action as
 * content. Mirrors goal-host's rule exactly (repos/goal-host-vessel
 * src/walk-pool.ts `isWriteShape`), so the surface and the walk agree on which
 * missing targets a human could supply.
 */
export function isWriteShape(shape: string): boolean {
  return /_write$/.test(shape) || /(^|:)write_note$/.test(shape) || /^(fs_write|fs_edit|fileWriteResult|fileEditResult)$/.test(shape);
}

/**
 * Whether a person can sensibly provide this missing shape: one named for
 * human input (`human_context`, `human_input`, …). Everything else a walk
 * misses (`execution_trace`, `activity_template`, `test_suite`) is the
 * system's own vocabulary, which a person has no way to supply, and offering to
 * take it asks them to do the system's work in its terms.
 */
export function isHumanProvidable(shape: string): boolean {
  return /^human[_:]/.test(shape) && !isWriteShape(shape);
}
