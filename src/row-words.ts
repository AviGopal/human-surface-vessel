/**
 * Which fields hold a row's words. A row reads as words, its record folded
 * (surface-acts-on-shapes-present R.2): the declaration is the owner's `shape_description` row
 * for the row's shape, naming the fields in its own `words`; else the view entry's `words`;
 * else none, and the row is drawn as its shape and time. The surface names no field itself.
 *
 * Shared by the view check (src/ui-views.ts) and the page (ui/src/components/Reports.tsx), so
 * an entry's `words` and an owner's declaration are held to one rule.
 */
export const MAX_WORDS = 4;
export const FIELD_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

/** Whether `v` names 1 to MAX_WORDS distinct field names. */
export function wordFields(v: unknown): v is readonly string[] {
  return Array.isArray(v) && v.length >= 1 && v.length <= MAX_WORDS && new Set(v).size === v.length && v.every((f) => typeof f === "string" && FIELD_NAME.test(f));
}

/**
 * The owners' declarations in a `record_read` of `shape_description`: per described shape
 * (`of`), the fields its latest row names in `words`. Records returns rows oldest first and a
 * later row is the state, so a later declaration replaces an earlier one; a later row naming
 * no valid `words` withdraws it.
 */
export function declaredWords(answer: unknown): ReadonlyMap<string, readonly string[]> {
  const out = new Map<string, readonly string[]>();
  if (!Array.isArray(answer)) return out;
  for (const row of answer) {
    if (typeof row !== "object" || row === null) continue;
    const { of, words } = row as Record<string, unknown>;
    if (typeof of !== "string") continue;
    if (wordFields(words)) out.set(of, words);
    else out.delete(of);
  }
  return out;
}

/** The fields drawn as `shape`'s words: the owner's declaration, else the entry's, else none. */
export function wordsFor(shape: unknown, declared: ReadonlyMap<string, readonly string[]>, entryWords: readonly string[] | undefined): readonly string[] | null {
  return (typeof shape === "string" ? declared.get(shape) : undefined) ?? entryWords ?? null;
}

/**
 * A row's words: each declared field the row carries, in the declared order, with its value as
 * the producer wrote it. A declared field the row lacks or leaves empty adds nothing.
 */
export function rowWords(row: Readonly<Record<string, unknown>>, fields: readonly string[] | null): { field: string; value: unknown }[] {
  const out: { field: string; value: unknown }[] = [];
  for (const field of fields ?? []) {
    const value = row[field];
    if (value !== undefined && value !== null && value !== "") out.push({ field, value });
  }
  return out;
}
