/**
 * The reports a view names, each read by shape through discovery and drawn as it was
 * answered. The surface does not interpret a report: it shows a report's plain values
 * and the size of its lists, and says plainly when nothing answered and why. Which
 * reports appear is the view's (src/ui-views.ts), so the system changes this screen
 * by writing a view, not by a rebuild.
 */
import type { ReactNode } from "react";
import type { ReportAnswer, ReportPointer } from "../api/client";
import { useReport } from "../api/queries";

/** How many plain values a report shows before "and N more". */
const FIELDS_SHOWN = 8;
/** How many items of a list are named under it. */
const ITEMS_NAMED = 3;
/** The fields that name an item, in the order tried. */
const NAME_FIELDS = ["summary", "title", "name", "goal", "unit", "activity_id", "id"] as const;

/** A shape name as words: `trace_failure_pattern_report` → "trace failure pattern report". */
export function reportTitle(type: string): string {
  return type
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_:.-]+/g, " ")
    .toLowerCase()
    .trim();
}

function plain(v: unknown): string {
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(Math.round(v * 1000) / 1000);
  if (typeof v === "boolean") return v ? "yes" : "no";
  return String(v);
}

function isPlain(v: unknown): v is string | number | boolean {
  return typeof v === "string" || typeof v === "number" || typeof v === "boolean";
}

/** What one item of a list is called: its first naming field, else its first plain value. */
export function itemName(item: unknown): string {
  if (isPlain(item)) return plain(item).slice(0, 120);
  if (typeof item !== "object" || item === null) return "—";
  const o = item as Record<string, unknown>;
  for (const k of NAME_FIELDS) if (typeof o[k] === "string" && o[k]) return (o[k] as string).slice(0, 120);
  const first = Object.values(o).find(isPlain);
  return first === undefined ? "—" : plain(first).slice(0, 120);
}

/** The rows a report draws: plain values as they are, a list as its size and first items, a nested object as its plain values. */
export function reportRows(answer: unknown): { label: string; value: string; items?: readonly string[] }[] {
  if (Array.isArray(answer)) return [{ label: "rows", value: String(answer.length), items: answer.slice(0, ITEMS_NAMED).map(itemName) }];
  if (typeof answer !== "object" || answer === null) return [{ label: "answer", value: plain(answer) }];
  const rows: { label: string; value: string; items?: readonly string[] }[] = [];
  for (const [k, v] of Object.entries(answer as Record<string, unknown>)) {
    if (v === null || v === undefined) continue;
    if (isPlain(v)) rows.push({ label: k.replace(/_/g, " "), value: plain(v) });
    else if (Array.isArray(v)) rows.push({ label: k.replace(/_/g, " "), value: String(v.length), items: v.slice(0, ITEMS_NAMED).map(itemName) });
    else {
      for (const [k2, v2] of Object.entries(v as Record<string, unknown>)) {
        if (isPlain(v2)) rows.push({ label: `${k} ${k2}`.replace(/_/g, " "), value: plain(v2) });
      }
    }
  }
  return rows;
}

function Report({ pointer, enabled, intervalMs }: { pointer: ReportPointer; enabled: boolean; intervalMs: number }): ReactNode {
  const q = useReport(pointer, { enabled, intervalMs });
  const title = reportTitle(pointer.type);
  const a: ReportAnswer | undefined = q.data;
  let inner: ReactNode;
  if (!a) inner = <p className="sf-muted sf-report-note">{q.isError ? "no answer: the read failed" : "reading…"}</p>;
  else if (!a.ok) inner = <p className="sf-muted sf-report-note">no answer: {a.reason}</p>;
  else {
    const rows = reportRows(a.answer);
    const shown = rows.slice(0, FIELDS_SHOWN);
    inner = rows.length === 0 ? (
      <p className="sf-muted sf-report-note">answered with nothing</p>
    ) : (
      <>
        <dl className="sf-report-fields">
          {shown.map((r) => (
            <div key={r.label} className="sf-report-field">
              <dt>{r.label}</dt>
              <dd>
                {r.value}
                {r.items && r.items.length > 0 ? <span className="sf-report-items">{r.items.join(" · ")}</span> : null}
              </dd>
            </div>
          ))}
        </dl>
        {rows.length > shown.length ? <p className="sf-muted sf-report-note">and {rows.length - shown.length} more</p> : null}
      </>
    );
  }
  return (
    <section className="sf-report" data-report={pointer.type} aria-label={title}>
      <h3 className="sf-report-title">{title}</h3>
      {inner}
    </section>
  );
}

export function Reports({ pointers, enabled, intervalMs }: { pointers: readonly ReportPointer[]; enabled: boolean; intervalMs: number }): ReactNode {
  return (
    <div className="sf-reports">
      {pointers.map((p) => (
        <Report key={JSON.stringify(p)} pointer={p} enabled={enabled} intervalMs={intervalMs} />
      ))}
    </div>
  );
}
