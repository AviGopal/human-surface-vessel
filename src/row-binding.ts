/**
 * How a thread's read is bound to the row it is drawn under. In an entry's `thread`, a pointer
 * argument written as ROW_BINDING stands for the id of that row: the one value the page knows per
 * row and a view's writer cannot. Written as ROW_BINDING, a dot and a field name (an argument or a
 * `where` value), it stands for that field of the row as written, so a thread reads what shares a
 * value with its row (a change's tree) as well as what cites it. A row without that field, or whose
 * field is not a plain value, draws no thread.
 *
 * Shared by the view check (src/ui-views.ts) and the page (ui/src/components/Reports.tsx).
 */
import { FIELD_NAME } from "./row-words.ts";

export const ROW_BINDING = "$row";
/** `$row.<field>`: the row's top-level field, by name. */
export const ROW_FIELD_BINDING = new RegExp(`^\\$row\\.(${FIELD_NAME.source.slice(1, -1)})$`);

type Plain = string | number | boolean;
type Pointer = Readonly<Record<string, Plain | Readonly<Record<string, Plain>>>>;

const valuesOf = (pointer: Pointer): unknown[] =>
  Object.entries(pointer).flatMap(([k, v]) => (k === "where" && typeof v === "object" && v !== null ? Object.values(v) : [v]));

/** Whether a pointer is bound to the row it is drawn under: by its id or by one of its fields. */
export function boundToRow(pointer: Pointer): boolean {
  return valuesOf(pointer).some((v) => v === ROW_BINDING || (typeof v === "string" && ROW_FIELD_BINDING.test(v)));
}

/** The pointer with each binding replaced by the row's value, or null when the row cannot bind it. */
export function bindRow<P extends Pointer>(pointer: P, row: Readonly<Record<string, unknown>>): P | null {
  let unbound = false;
  const one = (v: unknown): unknown => {
    if (v === ROW_BINDING) {
      if (typeof row["id"] !== "string") unbound = true;
      return row["id"];
    }
    const m = typeof v === "string" ? ROW_FIELD_BINDING.exec(v) : null;
    if (!m) return v;
    const got = row[m[1]!];
    if (typeof got !== "string" && typeof got !== "number" && typeof got !== "boolean") unbound = true;
    return got;
  };
  const out = Object.fromEntries(
    Object.entries(pointer).map(([k, v]) => [k, k === "where" && typeof v === "object" && v !== null ? Object.fromEntries(Object.entries(v).map(([f, x]) => [f, one(x)])) : one(v)]),
  );
  return unbound ? null : (out as P);
}
