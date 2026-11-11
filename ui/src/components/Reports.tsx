/**
 * The entries a view names, each read by shape through discovery and drawn in the form the
 * entry names. The surface does not interpret an answer and names no section: the title is
 * the view writer's, or the shape's name. Every entry is drawn, and one with no answer says
 * why. Which entries appear is the view's (src/ui-views.ts), so the system changes this
 * screen by writing a view, not by a rebuild.
 *
 * `fields`: an answer's plain values, and each list as its size and first items.
 * `rows`: each row with every field as the producer wrote it, nothing chosen or reordered by
 * the surface; with `judge: "outcome"` each row offers a person's verdict, written as an
 * outcome row citing it under their own key.
 * `questions`: each row is a question this surface holds, opened on selection.
 */
import { useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { writeOutcome, type ReportAnswer, type ViewEntry } from "../api/client";
import { useReport } from "../api/queries";
import { SESSION_KEY, useSession } from "../api/session";
import type { Question } from "../api/participation";
import { questionRowSubject } from "../state/questions";
import { useLimits } from "../state/limits";

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
export function reportRows(answer: unknown, itemsNamed: number): { label: string; value: string; items?: readonly string[] }[] {
  if (Array.isArray(answer)) return [{ label: "rows", value: String(answer.length), items: answer.slice(0, itemsNamed).map(itemName) }];
  if (typeof answer !== "object" || answer === null) return [{ label: "answer", value: plain(answer) }];
  const rows: { label: string; value: string; items?: readonly string[] }[] = [];
  for (const [k, v] of Object.entries(answer as Record<string, unknown>)) {
    if (v === null || v === undefined) continue;
    if (isPlain(v)) rows.push({ label: k.replace(/_/g, " "), value: plain(v) });
    else if (Array.isArray(v)) rows.push({ label: k.replace(/_/g, " "), value: String(v.length), items: v.slice(0, itemsNamed).map(itemName) });
    else {
      for (const [k2, v2] of Object.entries(v as Record<string, unknown>)) {
        if (isPlain(v2)) rows.push({ label: `${k} ${k2}`.replace(/_/g, " "), value: plain(v2) });
      }
    }
  }
  return rows;
}

/** A field's value as words, in full: text as written, a list as its items, a nested object as JSON. */
export function fieldText(v: unknown): string {
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(", ");
  if (typeof v === "object" && v !== null) return JSON.stringify(v);
  return plain(v);
}

type Verdict = { state: "idle" } | { state: "sending"; r: 0 | 1 } | { state: "done"; r: 0 | 1; seq: number | null } | { state: "refused"; reason: string } | { state: "signedOut" };

function Judge({ rowId }: { rowId: string }): ReactNode {
  const session = useSession();
  const client = useQueryClient();
  const [verdict, setVerdict] = useState<Verdict>({ state: "idle" });
  const signedIn = session.data?.signedIn === true;
  const give = async (r: 0 | 1): Promise<void> => {
    setVerdict({ state: "sending", r });
    const got = await writeOutcome(rowId, r);
    if (!got.ok && got.signedOut) {
      // The page still showed a sign-in the surface no longer holds (it restarted, or the
      // sign-in ran out): read the session again so the page says so everywhere.
      setVerdict({ state: "signedOut" });
      void client.invalidateQueries({ queryKey: SESSION_KEY });
      return;
    }
    setVerdict(got.ok ? { state: "done", r, seq: got.seq } : { state: "refused", reason: got.reason });
  };
  return (
    <div className="sf-row-judge" role="group" aria-label="Your verdict on this">
      {verdict.state === "done" ? (
        <p className="sf-row-note">
          You judged this {verdict.r === 1 ? "right" : "wrong"}
          {verdict.seq !== null ? ` (record #${verdict.seq})` : ""}. Judging again replaces it.
        </p>
      ) : null}
      <button type="button" className="sf-button" disabled={!signedIn || verdict.state === "sending"} onClick={() => void give(1)}>
        Right
      </button>
      <button type="button" className="sf-button" disabled={!signedIn || verdict.state === "sending"} onClick={() => void give(0)}>
        Wrong
      </button>
      {verdict.state === "signedOut" ? (
        <p className="sf-row-note" role="alert">
          Your verdict was not recorded: you are no longer signed in (the surface may have restarted). Sign in with your key and judge again.
        </p>
      ) : !signedIn ? (
        <p className="sf-muted sf-row-note">Sign in with your key to give a verdict.</p>
      ) : null}
      {verdict.state === "refused" ? (
        <p className="sf-row-note" role="alert">
          Not recorded: {verdict.reason}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The rows an entry draws: the answer, or the field of it the entry names, and with `show`
 * only the last n in the order the producer returned them. Null when there are no rows to
 * draw, with what was found instead.
 */
export function rowsOf(answer: unknown, entry: Pick<ViewEntry, "field" | "show">): { rows: readonly unknown[]; total: number } | { missing: string } {
  const at = entry.field === undefined ? answer : typeof answer === "object" && answer !== null && !Array.isArray(answer) ? (answer as Record<string, unknown>)[entry.field] : undefined;
  if (at === undefined || at === null) return { missing: entry.field === undefined ? "answered with nothing" : `the answer has no ${entry.field}` };
  const all = Array.isArray(at) ? at : [at];
  return { rows: entry.show === undefined ? all : all.slice(-entry.show), total: all.length };
}

function Rows({ rows, judge }: { rows: readonly unknown[]; judge: boolean }): ReactNode {
  return (
    <ol className="sf-rows">
      {rows.map((row, i) => {
        const o: Record<string, unknown> = typeof row === "object" && row !== null && !Array.isArray(row) ? (row as Record<string, unknown>) : { value: row };
        const id = typeof o["id"] === "string" ? (o["id"] as string) : null;
        return (
          <li key={id ?? i} className="sf-row" data-row={id ?? undefined}>
            <dl className="sf-row-fields">
              {Object.entries(o).map(([k, v]) => (
                <div key={k} className="sf-row-field">
                  <dt>{k.replace(/_/g, " ")}</dt>
                  <dd>{fieldText(v)}</dd>
                </div>
              ))}
            </dl>
            {judge && id ? <Judge rowId={id} /> : null}
          </li>
        );
      })}
    </ol>
  );
}

function Questions({ rows, onOpen }: { rows: readonly unknown[]; onOpen: (id: string) => void }): ReactNode {
  return (
    <ul className="sf-landing-list">
      {rows.map((row, i) => {
        const id = typeof row === "object" && row !== null && typeof (row as Record<string, unknown>)["id"] === "string" ? ((row as Record<string, unknown>)["id"] as string) : null;
        // A row here is a question this surface holds, so it is named as the questions rail names it.
        const name = id ? questionRowSubject(row as Question) || itemName(row) : itemName(row);
        return (
          <li key={id ?? i}>
            {id ? (
              <button type="button" className="sf-landing-row" onClick={() => onOpen(id)}>
                <span className="sf-landing-text">{name}</span>
              </button>
            ) : (
              <span className="sf-landing-text">{name}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function Fields({ answer }: { answer: unknown }): ReactNode {
  const limits = useLimits();
  const rows = reportRows(answer, limits.itemsNamed);
  const shown = rows.slice(0, limits.fieldsShown);
  if (rows.length === 0) return <p className="sf-muted sf-report-note">answered with nothing</p>;
  return (
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

/** The answer drawn in the entry's form, or what was found instead of rows. */
function Drawn({ entry, answer, onOpenQuestion }: { entry: ViewEntry; answer: unknown; onOpenQuestion: (id: string) => void }): ReactNode {
  if (entry.form === "fields") return <Fields answer={answer} />;
  const got = rowsOf(answer, entry);
  if ("missing" in got) return <p className="sf-muted sf-report-note">{got.missing}</p>;
  if (got.rows.length === 0) return <p className="sf-muted sf-report-note">answered with no rows</p>;
  return (
    <>
      {got.total > got.rows.length ? <p className="sf-muted sf-report-note">the last {got.rows.length} of {got.total}</p> : null}
      {entry.form === "questions" ? <Questions rows={got.rows} onOpen={onOpenQuestion} /> : <Rows rows={got.rows} judge={entry.judge === "outcome"} />}
    </>
  );
}

function Entry({ entry, enabled, intervalMs, onOpenQuestion }: { entry: ViewEntry; enabled: boolean; intervalMs: number; onOpenQuestion: (id: string) => void }): ReactNode {
  const pointer = entry.pointer;
  const q = useReport(pointer, { enabled, intervalMs });
  const title = entry.title ?? reportTitle(pointer.type);
  const a: ReportAnswer | undefined = q.data;
  let inner: ReactNode;
  if (!a) inner = <p className="sf-muted sf-report-note">{q.isError ? "no answer: the read failed" : "reading…"}</p>;
  else if (!a.ok) inner = <p className="sf-muted sf-report-note">no answer: {a.reason}</p>;
  else inner = <Drawn entry={entry} answer={a.answer} onOpenQuestion={onOpenQuestion} />;
  return (
    <section className="sf-report" data-report={pointer.type} data-form={entry.form} aria-label={title}>
      <h2 className="sf-report-title">{title}</h2>
      {inner}
    </section>
  );
}

export function Entries({
  entries,
  enabled,
  intervalMs,
  onOpenQuestion,
}: {
  entries: readonly ViewEntry[];
  enabled: boolean;
  intervalMs: number;
  onOpenQuestion: (id: string) => void;
}): ReactNode {
  return (
    <div className="sf-reports">
      {entries.map((e) => (
        <Entry key={JSON.stringify(e.pointer)} entry={e} enabled={enabled} intervalMs={intervalMs} onOpenQuestion={onOpenQuestion} />
      ))}
    </div>
  );
}
