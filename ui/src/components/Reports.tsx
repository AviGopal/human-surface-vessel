/**
 * The entries a view names, each read by shape through discovery and drawn in the form the
 * entry names. The surface does not interpret an answer and names no section: the title is
 * the view writer's, or the shape's name. Every entry is drawn, and one with no answer says
 * why. Which entries appear is the view's (src/ui-views.ts), so the system changes this
 * screen by writing a view, not by a rebuild.
 *
 * `fields`: an answer's plain values, and each list as its size and first items.
 * `rows`: each row as its words, every field as the producer wrote it folded under "details",
 * nothing chosen or reordered by the surface. Which fields are the words is declared, never
 * guessed (src/row-words.ts): the owner's `shape_description` row for the row's shape, else the
 * entry's `words`; with neither the row shows its shape and time. With `judge: "outcome"`
 * each row offers a person's verdict, outside the fold, written as an outcome row citing it
 * under their own key.
 * `questions`: each row is a question this surface holds, opened on selection.
 * A folded entry with `strip: {hours}` draws in its summary one bar per hour of the last `hours`,
 * each as tall as the rows read whose `t` falls in it, on that strip's own scale; from the rows
 * already read, never a second read. A read cut to its newest rows (its pointer's `last`) that
 * does not reach back to the window's start says so, rather than drawing a strip that looks whole.
 * An entry's `thread` is read again under each row it draws, bound to that row's id, and drawn
 * as its own entry: a person's ask shows the rows citing it. One level; the rows are its read's.
 */
import { useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { bind, ROW_BINDING, writeOutcome, type ReportAnswer, type ViewEntry } from "../api/client";
import { useReport } from "../api/queries";
import { SESSION_KEY, useSession } from "../api/session";
import type { Question } from "../api/participation";
import { questionRowSubject } from "../state/questions";
import { useLimits } from "../state/limits";
import { declaredWords, rowWords, wordsFor } from "../lib/rowWords";
import { Prose } from "./Prose";
import { relative } from "./ContentRender";

/** Where the owners' declarations of a row's words are read: records' `shape_description` rows. */
const DECLARATIONS = { type: "record_read", shape: "shape_description" } as const;

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

const SIGN_IN_TO_JUDGE = "Sign in with your key to give a verdict.";

/** Whether any entry, or its thread, offers a verdict: the page says how to sign in once, not under every row. */
function offersVerdicts(entries: readonly ViewEntry[]): boolean {
  return entries.some((e) => e.judge === "outcome" || e.thread?.judge === "outcome");
}

/** An outcome's `r` as words: right for 1, wrong for 0, else the value as written. */
function gradeWords(r: unknown): string {
  return r === 1 ? "right" : r === 0 ? "wrong" : `r ${fieldText(r)}`;
}

/**
 * The system's own grades of a row, through the view's declared `graded` read: which grades are
 * the system's is that read's `where`, never sorted out here. Mounted only after this person's
 * verdict, so nothing of it is read or drawn before; drawn closed, and outside Right and Wrong.
 */
function SystemGrade({ graded, rowId, reading }: { graded: NonNullable<ViewEntry["graded"]>; rowId: string; reading: Pick<Reading, "enabled" | "intervalMs"> }): ReactNode {
  const q = useReport(bind(graded.pointer, ROW_BINDING, rowId), { enabled: reading.enabled, intervalMs: reading.intervalMs });
  const a: ReportAnswer | undefined = q.data;
  const got = a?.ok ? rowsOf(a.answer, {}) : null;
  return (
    <details className="sf-row-system-grade" data-system-grade="">
      <summary>the system's own grade</summary>
      {!a ? (
        <p className="sf-muted sf-row-note">{q.isError ? "no answer: the read failed" : "reading…"}</p>
      ) : !a.ok ? (
        <p className="sf-muted sf-row-note">no answer: {a.reason}</p>
      ) : !got || "missing" in got || got.rows.length === 0 ? (
        <p className="sf-muted sf-row-note">The system has not graded this.</p>
      ) : (
        <ul className="sf-row-system-grades">
          {got.rows.map((row, i) => {
            const o = typeof row === "object" && row !== null ? (row as Record<string, unknown>) : {};
            const time = when(o["t"]);
            return (
              <li key={typeof o["id"] === "string" ? o["id"] : i}>
                the system graded this: {gradeWords(o["r"])}
                {time ? ` · ${time}` : ""}
              </li>
            );
          })}
        </ul>
      )}
    </details>
  );
}

function Judge({ rowId, graded, reading }: { rowId: string; graded?: ViewEntry["graded"]; reading: Pick<Reading, "enabled" | "intervalMs"> }): ReactNode {
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
    <>
    <div className="sf-row-judge" role="group" aria-label="Your verdict on this">
      {verdict.state === "done" ? (
        <p className="sf-row-note">
          You judged this {verdict.r === 1 ? "right" : "wrong"}
          {verdict.seq !== null ? ` (record #${verdict.seq})` : ""}. Judging again replaces it.
        </p>
      ) : null}
      <button type="button" className="sf-button" disabled={!signedIn || verdict.state === "sending"} title={signedIn ? undefined : SIGN_IN_TO_JUDGE} onClick={() => void give(1)}>
        Right
      </button>
      <button type="button" className="sf-button" disabled={!signedIn || verdict.state === "sending"} title={signedIn ? undefined : SIGN_IN_TO_JUDGE} onClick={() => void give(0)}>
        Wrong
      </button>
      {verdict.state === "signedOut" ? (
        <p className="sf-row-note" role="alert">
          Your verdict was not recorded: you are no longer signed in (the surface may have restarted). Sign in with your key and judge again.
        </p>
      ) : null}
      {verdict.state === "refused" ? (
        <p className="sf-row-note" role="alert">
          Not recorded: {verdict.reason}
        </p>
      ) : null}
    </div>
    {verdict.state === "done" && graded ? <SystemGrade graded={graded} rowId={rowId} reading={reading} /> : null}
    </>
  );
}

/**
 * The rows an entry draws: the answer, or the field of it the entry names, and with `show`
 * only the last n in the order the producer returned them; with `newest`, those n reversed, on a
 * copy, so the cut stays the producer's. `earlier` is what the cut left out, in the same order,
 * drawn folded rather than dropped. Null when there are no rows to draw, with what was found instead.
 */
export function rowsOf(answer: unknown, entry: Pick<ViewEntry, "field" | "show" | "newest">): { rows: readonly unknown[]; earlier: readonly unknown[]; total: number } | { missing: string } {
  const at = entry.field === undefined ? answer : typeof answer === "object" && answer !== null && !Array.isArray(answer) ? (answer as Record<string, unknown>)[entry.field] : undefined;
  if (at === undefined || at === null) return { missing: entry.field === undefined ? "answered with nothing" : `the answer has no ${entry.field}` };
  const all = Array.isArray(at) ? at : [at];
  const cut = entry.show === undefined ? 0 : Math.max(0, all.length - entry.show);
  const kept = all.slice(cut);
  const earlier = all.slice(0, cut);
  return { rows: entry.newest ? [...kept].reverse() : kept, earlier: entry.newest ? [...earlier].reverse() : earlier, total: all.length };
}

/** A row's time as the person's clock reads it; the producer's text when it is not a time. */
/** A row time in the reader's own zone, named, so it lines up with times written elsewhere in UTC. */
const WHEN: Intl.DateTimeFormatOptions = { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" };

function when(t: unknown): string | null {
  if (typeof t !== "string") return null;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? t : d.toLocaleString(undefined, WHEN);
}

/**
 * A row's time as an age ("12m ago"), the exact instant with its zone on hover and in the DOM, so
 * it takes a few characters of the row's line and can still be lined up with times elsewhere.
 */
function RowTime({ t, full }: { t: string; full: string }): ReactNode {
  const ms = Date.parse(t);
  return Number.isNaN(ms) ? (
    <p className="sf-muted sf-row-time">{full}</p>
  ) : (
    <time className="sf-muted sf-row-time" dateTime={t} title={full}>
      {relative(ms)}
    </time>
  );
}

/**
 * One declared field as words: text as its writer formatted it, line breaks kept, through Prose,
 * which builds elements and draws markup and links as text; any other value as one line with its field's name.
 */
function Word({ k, v }: { k: string; v: unknown }): ReactNode {
  return typeof v === "string" ? (
    <div className="sf-row-words sf-row-prose">
      <Prose source={v} breaks />
    </div>
  ) : (
    <p className="sf-row-words">{`${k.replace(/_/g, " ")} ${fieldText(v)}`}</p>
  );
}

type Reading = { declared: ReadonlyMap<string, readonly string[]>; enabled: boolean; intervalMs: number; onOpenQuestion: (id: string) => void };

/** An entry's thread under one row: its read, bound to the row's id, drawn as its own entry. */
function Thread({ entry, rowId, reading }: { entry: ViewEntry; rowId: string; reading: Reading }): ReactNode {
  const pointer = bind(entry.pointer, ROW_BINDING, rowId);
  const q = useReport(pointer, { enabled: reading.enabled, intervalMs: reading.intervalMs });
  const a: ReportAnswer | undefined = q.data;
  return (
    <div className="sf-thread" data-thread-of={rowId}>
      {!a ? (
        <p className="sf-muted sf-report-note">{q.isError ? "no answer: the read failed" : "reading…"}</p>
      ) : !a.ok ? (
        <p className="sf-muted sf-report-note">no answer: {a.reason}</p>
      ) : (
        <Drawn entry={entry} answer={a.answer} reading={reading} />
      )}
    </div>
  );
}

function Rows({ rows, entry, reading }: { rows: readonly unknown[]; entry: ViewEntry; reading: Reading }): ReactNode {
  const judge = entry.judge === "outcome";
  return (
    <ol className="sf-rows">
      {rows.map((row, i) => {
        const o: Record<string, unknown> = typeof row === "object" && row !== null && !Array.isArray(row) ? (row as Record<string, unknown>) : { value: row };
        const id = typeof o["id"] === "string" ? (o["id"] as string) : null;
        const words = rowWords(o, wordsFor(o["shape"], reading.declared, entry.words));
        const time = when(o["t"]);
        return (
          <li key={id ?? i} className={entry.thread ? "sf-row sf-row-parent" : "sf-row"} data-row={id ?? undefined}>
            {words.length > 0 ? (
              words.map((w, j) => <Word key={j} k={w.field} v={w.value} />)
            ) : (
              <p className="sf-row-words sf-muted">{typeof o["shape"] === "string" ? reportTitle(o["shape"]) : "a row"}</p>
            )}
            <div className="sf-row-meta">
              {time ? <RowTime t={o["t"] as string} full={time} /> : null}
              <details className="sf-row-details">
                <summary>details</summary>
                <dl className="sf-row-fields">
                  {Object.entries(o).map(([k, v]) => (
                    <div key={k} className="sf-row-field">
                      <dt>{k.replace(/_/g, " ")}</dt>
                      <dd>{fieldText(v)}</dd>
                    </div>
                  ))}
                </dl>
              </details>
              {judge && id ? <Judge rowId={id} graded={entry.graded} reading={reading} /> : null}
            </div>
            {entry.thread && id ? <Thread entry={entry.thread} rowId={id} reading={reading} /> : null}
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

/** Why the producer served no rows, when it said: its `empty_reason`, ahead of the view's own words. */
function emptyReasonOf(answer: unknown): string | null {
  const why = typeof answer === "object" && answer !== null && !Array.isArray(answer) ? (answer as Record<string, unknown>)["empty_reason"] : undefined;
  return typeof why === "string" && why.trim() ? why.trim().slice(0, 300) : null;
}

/**
 * An entry with no rows: the view's own words first, when it declares them, with the producer's
 * reason folded under "why"; else the producer's reason; else a plain note. The reason is never
 * dropped, only placed behind the plain sentence.
 */
function Empty({ said, why }: { said: string | undefined; why: string | null }): ReactNode {
  if (said === undefined) return <p className="sf-muted sf-report-note">{why ?? "answered with no rows"}</p>;
  return (
    <>
      <p className="sf-muted sf-report-note">{said}</p>
      {why !== null && why !== said ? (
        <details className="sf-row-details" data-empty-reason="">
          <summary>why</summary>
          <p className="sf-muted sf-report-note">{why}</p>
        </details>
      ) : null}
    </>
  );
}

/** The answer drawn in the entry's form, or what was found instead of rows. */
function Drawn({ entry, answer, reading }: { entry: ViewEntry; answer: unknown; reading: Reading }): ReactNode {
  if (entry.form === "fields") return <Fields answer={answer} />;
  const got = rowsOf(answer, entry);
  if ("missing" in got) return <p className="sf-muted sf-report-note">{got.missing}</p>;
  if (got.rows.length === 0) return <Empty said={entry.empty} why={emptyReasonOf(answer)} />;
  const draw = (rows: readonly unknown[]): ReactNode =>
    entry.form === "questions" ? <Questions rows={rows} onOpen={reading.onOpenQuestion} /> : <Rows rows={rows} entry={entry} reading={reading} />;
  return (
    <>
      {draw(got.rows)}
      {got.earlier.length > 0 ? <Earlier count={got.earlier.length} draw={() => draw(got.earlier)} /> : null}
    </>
  );
}

const HOUR_MS = 3_600_000;

/** An hour as the viewer's clock names it: "3 PM", or "15" where the locale reads so. */
const hourName = (ms: number): string => new Date(ms).toLocaleTimeString(undefined, { hour: "numeric" });

/**
 * How many of `rows` fall in each of the last `hours` hours on the viewer's clock, the current hour last, oldest bin
 * first, and whether the read was cut short of the window.
 */
export function stripOf(rows: readonly unknown[], hours: number, now: number, last?: number): { bins: number[]; start: number; cut: boolean } {
  const next = new Date(now);
  next.setMinutes(60, 0, 0);
  const start = next.getTime() - hours * HOUR_MS;
  const bins = new Array<number>(hours).fill(0);
  let oldest = Infinity;
  for (const r of rows) {
    const t = typeof r === "object" && r !== null ? Date.parse(String((r as Record<string, unknown>)["t"])) : NaN;
    if (Number.isNaN(t)) continue;
    oldest = Math.min(oldest, t);
    const i = Math.floor((t - start) / HOUR_MS);
    if (i >= 0 && i < hours) bins[i]! += 1;
  }
  const cut = last !== undefined && rows.length >= last && oldest > start;
  return { bins, start, cut };
}

function Strip({ rows, hours, last }: { rows: readonly unknown[]; hours: number; last?: number }): ReactNode {
  const { bins, start, cut } = stripOf(rows, hours, Date.now(), last);
  const total = bins.reduce((a, b) => a + b, 0);
  const top = Math.max(...bins);
  const span = hours === 1 ? "last hour" : `last ${hours} hours`;
  const said = cut
    ? `only the latest ${rows.length} shown`
    : total === 0
      ? `none in the ${span}`
      : `${total} in the ${span}, most around ${hourName(start + bins.indexOf(top) * HOUR_MS)}`;
  return (
    <span className="sf-strip-wrap" data-strip={hours}>
      <span className="sf-strip-plot">
      <span className="sf-strip" role="img" aria-label={said} data-cut={cut ? "" : undefined}>
        {bins.map((n, i) => (
          <span
            key={i}
            className="sf-strip-bar"
            data-n={n}
            // A share of the strip's height (its stylesheet's); a bin with any row is never drawn flat.
            style={{ height: `${n === 0 ? 0 : Math.round((n / top) * 100)}%`, minHeight: n === 0 ? undefined : "1px" }}
            title={`${hourName(start + i * HOUR_MS)}: ${n}`}
          />
        ))}
      </span>
      {/* The strip's two ends in words, so a sighted reader sees when as well as how many. */}
      <span className="sf-strip-axis" aria-hidden="true">
        <span>{`${hours} h ago`}</span>
        <span>now</span>
      </span>
      </span>
      <span className="sf-strip-caption">{cut || total === 0 ? said : `${total} in the ${span}`}</span>
    </span>
  );
}

/** What a view's `show` left out: closed under what it shows, and neither drawn nor read until opened. */
function Earlier({ count, draw }: { count: number; draw: () => ReactNode }): ReactNode {
  const [open, setOpen] = useState(false);
  return (
    <details className="sf-earlier" data-earlier={count} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary>{count} earlier</summary>
      {open ? draw() : null}
    </details>
  );
}

function Entry({ entry, reading }: { entry: ViewEntry; reading: Reading }): ReactNode {
  const pointer = entry.pointer;
  const q = useReport(pointer, { enabled: reading.enabled, intervalMs: reading.intervalMs });
  const title = entry.title ?? reportTitle(pointer.type);
  const a: ReportAnswer | undefined = q.data;
  let inner: ReactNode;
  if (!a) inner = <p className="sf-muted sf-report-note">{q.isError ? "no answer: the read failed" : "reading…"}</p>;
  else if (!a.ok) inner = <p className="sf-muted sf-report-note">no answer: {a.reason}</p>;
  else inner = <Drawn entry={entry} answer={a.answer} reading={reading} />;
  if (entry.folded) {
    // Folded, but counted: the summary says how many rows the read holds before anyone opens it.
    const got = a?.ok && entry.form !== "fields" ? rowsOf(a.answer, entry) : null;
    const count = got && "total" in got ? got.total : null;
    return (
      <details className="sf-report sf-report-folded" data-report={pointer.type} data-form={entry.form} aria-label={title}>
        <summary className="sf-report-title">
          {/* The title and its count flow as one line of words, so a wrapped title keeps its count after its last word. */}
          <span className="sf-report-name">
            {title}
            {count !== null ? <span className="sf-report-count" data-count={count}>{entry.strip ? `${count} in all` : count}</span> : null}
          </span>
          {entry.strip && got && "total" in got ? (
            <Strip rows={[...got.earlier, ...got.rows]} hours={entry.strip.hours} last={typeof pointer["last"] === "number" ? (pointer["last"] as number) : undefined} />
          ) : null}
          {a && !a.ok ? <span className="sf-report-count" data-no-answer="">no answer</span> : null}
        </summary>
        {inner}
      </details>
    );
  }
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
  // Read on the entries' cadence, so a declaration an owner writes later moves what is shown with no reload.
  const declarations = useReport(DECLARATIONS, { enabled, intervalMs }).data;
  const declared = declarations?.ok ? declaredWords(declarations.answer) : new Map<string, readonly string[]>();
  const reading: Reading = { declared, enabled, intervalMs, onOpenQuestion };
  const session = useSession();
  const signedOut = session.data !== undefined && session.data.signedIn !== true;
  return (
    <>
      {signedOut && offersVerdicts(entries) ? <p className="sf-muted sf-report-note sf-sign-in-to-judge" data-sign-in-to-judge="">{SIGN_IN_TO_JUDGE}</p> : null}
      <div className="sf-reports">
        {entries.map((e) => (
          <Entry key={JSON.stringify(e.pointer)} entry={e} reading={reading} />
        ))}
      </div>
    </>
  );
}
