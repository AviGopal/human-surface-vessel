/**
 * Which fields of a row read as a state (surface-acts-on-shapes-present R.6). A state is one of
 * the design tokens' closed set, drawn as a dot in its colour and its own label, never colour
 * alone. The binding is declared, as words are (src/row-words.ts): the owner's `shape_description`
 * row for the row's shape, in its own `marks`; else the view entry's `marks`; else none. The
 * surface names no field and no shape: it draws a mark wherever a declaration binds one.
 *
 * Shared by the view check (src/ui-views.ts) and the page (ui/src/components/Reports.tsx), so a
 * view's marks and an owner's are held to one rule.
 */
import { FIELD_NAME, MAX_WORDS } from "./row-words.ts";

/** The states a mark may name: the design tokens' run states, each with a colour and a label. */
export const MARK_STATES = ["reached", "not-reached", "running", "waiting", "accepted", "stalled"] as const;
export type MarkState = (typeof MARK_STATES)[number];

/** A field path: a field name, or up to three joined by dots, read into nested objects. */
export const MARK_FIELD = new RegExp(`^${FIELD_NAME.source.slice(1, -1)}(\\.${FIELD_NAME.source.slice(1, -1)}){0,2}$`);
/** How many values one binding may name, and how long a label may be. */
export const MAX_MARK_VALUES = 8;
export const MAX_MARK_LABEL = 40;

/**
 * One binding: the field read, the state each of its values reads as (the value as written:
 * true, false, a number or a string, keyed by its text, so true and "true" read alike), and the
 * declarer's word for the field.
 */
export type MarkBinding = { readonly field: string; readonly states: Readonly<Record<string, MarkState>>; readonly label?: string };

/** Why `v` is not 1 to MAX_WORDS bindings, or null when it is. */
export function marksProblem(v: unknown): string | null {
  const shape = `marks: 1 to ${MAX_WORDS} {field, states: {value: state}, label?}; field a field name or a dotted path of up to 3, 1 to ${MAX_MARK_VALUES} values, each state one of ${MARK_STATES.join(", ")}, label 1 to ${MAX_MARK_LABEL} characters`;
  if (!Array.isArray(v) || v.length < 1 || v.length > MAX_WORDS) return shape;
  for (const b of v) {
    if (typeof b !== "object" || b === null || Array.isArray(b)) return shape;
    const { field, states, label, ...rest } = b as Record<string, unknown>;
    if (Object.keys(rest).length > 0) return shape;
    if (typeof field !== "string" || !MARK_FIELD.test(field)) return shape;
    if (label !== undefined && (typeof label !== "string" || !label.trim() || label.length > MAX_MARK_LABEL)) return shape;
    if (typeof states !== "object" || states === null || Array.isArray(states)) return shape;
    const values = Object.entries(states as Record<string, unknown>);
    if (values.length < 1 || values.length > MAX_MARK_VALUES) return shape;
    if (!values.every(([, s]) => (MARK_STATES as readonly unknown[]).includes(s))) return shape;
  }
  return null;
}

export function markBindings(v: unknown): v is readonly MarkBinding[] {
  return marksProblem(v) === null;
}

/**
 * The owners' declarations in a `record_read` of `shape_description`: per described shape (`of`),
 * the bindings its latest row names in `marks`. A later row is the state, so a later declaration
 * replaces an earlier one, and a later row naming no valid `marks` withdraws it.
 */
export function declaredMarks(answer: unknown): ReadonlyMap<string, readonly MarkBinding[]> {
  const out = new Map<string, readonly MarkBinding[]>();
  if (!Array.isArray(answer)) return out;
  for (const row of answer) {
    if (typeof row !== "object" || row === null) continue;
    const { of, marks } = row as Record<string, unknown>;
    if (typeof of !== "string") continue;
    if (markBindings(marks)) out.set(of, marks);
    else out.delete(of);
  }
  return out;
}

/** The bindings for `shape`: the owner's declaration, else the entry's, else none. */
export function marksFor(shape: unknown, declared: ReadonlyMap<string, readonly MarkBinding[]>, entryMarks: readonly MarkBinding[] | undefined): readonly MarkBinding[] {
  return (typeof shape === "string" ? declared.get(shape) : undefined) ?? entryMarks ?? [];
}

/**
 * A row's marks: for each binding, the state its field's value reads as. A field the row lacks,
 * or a value the binding does not name, adds no mark.
 */
export function rowMarks(row: Readonly<Record<string, unknown>>, bindings: readonly MarkBinding[]): { field: string; label: string; value: unknown; state: MarkState }[] {
  const out: { field: string; label: string; value: unknown; state: MarkState }[] = [];
  for (const b of bindings) {
    let value: unknown = row;
    for (const step of b.field.split(".")) value = typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>)[step] : undefined;
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") continue;
    const state = Object.prototype.hasOwnProperty.call(b.states, String(value)) ? b.states[String(value)] : undefined;
    if (state) out.push({ field: b.field, label: b.label?.trim() || b.field, value, state });
  }
  return out;
}
