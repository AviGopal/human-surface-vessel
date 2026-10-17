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
