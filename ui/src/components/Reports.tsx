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
 * entry's `words`; with neither the row shows its shape and time. With `judge` each row offers
 * a person's verdict, outside the fold, written under their own key as an outcome row citing it
 * ("outcome") or a land_verdict citing it ("land"); when the entry names `words`, only a row
 * holding one of them does. A word that is a diff is drawn as one, folded under its size.
 * `questions`: each row is a question this surface holds, opened on selection.
 * A folded entry with `strip: {hours}` draws in its summary one bar per hour of the last `hours`,
 * each as tall as the rows read whose `t` falls in it, on that strip's own scale; from the rows
 * already read, never a second read. A read cut to its newest rows (its pointer's `last`) that
 * does not reach back to the window's start says so, rather than drawing a strip that looks whole.
 * An entry's `thread` is read again under each row it draws, bound to that row's id, and drawn
 * as its own entry: a person's ask shows the rows citing it. One level; the rows are its read's.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { threadsOf, writeLandVerdict, writeOutcome, type ReportAnswer, type ReportPointer, type VerdictReader, type ViewEntry } from "../api/client";
import { useRenderPolicy, useReport } from "../api/queries";
import { SESSION_KEY, useSession } from "../api/session";
import type { Question } from "../api/participation";
import { questionRowSubject } from "../state/questions";
import { useLimits } from "../state/limits";
import { declaredWords, rowWords, wordsFor } from "../lib/rowWords";
import { declaredMarks, marksFor, rowMarks, type MarkBinding } from "../lib/rowMarks";
import { bindRow } from "../lib/rowBinding";
import { STATE_TOKENS } from "../design-tokens";
import { askAbout, citesOf } from "../lib/box";
import { Glyph } from "./Glyph";
import { Prose } from "./Prose";
import { QUESTION_CONTENT_SHAPE, QuestionView } from "./QuestionView";
import { planFor } from "./Rendered";
import { fromPanel } from "../lib/content";
import { reportExposureTick } from "../lib/exposure-reporter";
import { Diff, relative } from "./ContentRender";
import { diffSize, heuristicForm, parseDiff } from "../lib/ledger";

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

type Verdict = { state: "idle" } | { state: "sending"; r: 0 | 1 } | { state: "done"; r: 0 | 1; seq: number; id: string } | { state: "refused"; reason: string; said?: string } | { state: "signedOut" };

const SIGN_IN_TO_JUDGE = "Sign in with your key to give a verdict.";
/** What a read refused for want of a sign-in says: on the title's line, so a refused entry is one line high. */
const SIGN_IN_TO_SEE = "sign in to see";

/** Why a read drew nothing, in a person's words where they can act on it, else the producer's. */
function Unanswered({ a, className }: { a: Extract<ReportAnswer, { ok: false }>; className: string }): ReactNode {
  if (a.refused) return <p className={className} data-refused="">Not read: {a.reason}</p>;
  return a.signIn ? <p className={className} data-sign-in-to-see="">Sign in to see this.</p> : <p className={className}>no answer: {a.reason}</p>;
}

/** Whether any entry, or its thread, offers a verdict: the page says how to sign in once, not under every row. */
function offersVerdicts(entries: readonly ViewEntry[]): boolean {
  return entries.some((e) => e.judge !== undefined || threadsOf(e).some((t) => t.judge !== undefined));
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
function SystemGrade({ graded, row, reading }: { graded: NonNullable<ViewEntry["graded"]>; row: Readonly<Record<string, unknown>>; reading: Pick<Reading, "enabled" | "intervalMs"> }): ReactNode {
  // Bound as a thread is, so "$row" as an argument or a where value both read this row's id.
  const pointer = bindRow(graded.pointer, row);
  const q = useReport(pointer ?? { type: "record_read" }, { enabled: reading.enabled && pointer !== null, intervalMs: reading.intervalMs });
  const a: ReportAnswer | undefined = q.data;
  const got = a?.ok ? rowsOf(a.answer, {}) : null;
  return (
    <details className="sf-row-system-grade" data-system-grade="">
      <summary>the system's own grade</summary>
      {!a ? (
        <p className="sf-muted sf-row-note">{q.isError ? "no answer: the read failed" : "reading…"}</p>
      ) : !a.ok ? (
        <Unanswered a={a} className="sf-muted sf-row-note" />
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

/** What the system itself said of a write it did not take, one tap away under "why": a title is out of reach on a touch screen. */
export function Said({ said }: { said: string | undefined }): ReactNode {
  if (!said) return null;
  return (
    <details className="sf-row-details" data-said="">
      <summary>why</summary>
      <p className="sf-muted sf-report-note">{said}</p>
    </details>
  );
}

/** On the verdict given: what it is, and that the other word replaces it. */
const VERDICT_GIVEN = "Your verdict. Choosing the other replaces it.";

/**
 * Why Right is not offered on a change cut short. A landing counts a person's Right only when it
 * was given on the walk's whole diff of the tree; a Wrong counts on any. The USER ruled (11-15) that
 * a mark is offered only where it counts, so the page holds this one condition of the landing's.
 * Named debt: the condition is the landing's, kept here as well; its exit is the landing declaring
 * what a Right needs on its own row, read at use time like VERDICT_READERS.
 */
const RIGHT_NEEDS_WHOLE = "Right needs the whole change";

/**
 * The one fact the verdict's reader leaves, under a verdict given (src/ui-views.ts VERDICT_READERS):
 * records' standing of the person's own grade, read back by its id; or the gap's newest detector
 * row, once one is newer than the row judged, as a plain fact: a detector writes newer rows on its
 * own runs, and the page cannot tell a held gap (which the release reads) from one nobody holds
 * until the gap rows carry waits_for, so it never says the release read it; or nothing past the record it was stored as, where
 * the reader leaves nothing a read can reach. A field the row does not carry is not drawn, never as
 * a "no".
 */
function AfterVerdict({ after, row, mine, reading }: { after: VerdictReader["after"]; row: Readonly<Record<string, unknown>>; mine: string; reading: Pick<Reading, "enabled" | "intervalMs"> }): ReactNode {
  const gapId = typeof row["gap_id"] === "string" ? row["gap_id"] : null;
  const pointer: ReportPointer | null =
    after === "standing" ? { type: "record_read", refs_to: String(row["id"]), shape: "outcome" }
    : after === "gap" && gapId ? { type: "record_read", shape: "gap", latest_by: "gap_id", where: { gap_id: gapId } }
    : null;
  const q = useReport(pointer ?? { type: "record_read" }, { enabled: reading.enabled && pointer !== null, intervalMs: reading.intervalMs });
  if (!pointer) return null;
  const a: ReportAnswer | undefined = q.data;
  const got = a?.ok ? rowsOf(a.answer, {}) : null;
  const rows = got && !("missing" in got) ? (got.rows as readonly Record<string, unknown>[]) : [];
  let said: string | null = null;
  if (after === "standing") {
    const s = rows.find((r) => r["id"] === mine)?.["standing"] as { counted?: unknown; why?: unknown } | undefined;
    if (s?.counted === true) said = "Your grade counted.";
    else if (s?.counted === false) said = typeof s.why === "string" ? `Your grade did not count: ${s.why.replace(/_/g, " ")}.` : "Your grade did not count.";
  } else {
    const newer = rows.find((r) => typeof r["seq"] === "number" && typeof row["seq"] === "number" && r["seq"] > row["seq"]);
    if (newer) {
      const runnable = newer["check_runnable"] === false ? " · its test is set aside until a reviewed fix" : newer["check_runnable"] === true ? " · its test runs" : "";
      said = `Newest on this gap: ${typeof newer["status"] === "string" ? newer["status"] : "a newer row"}${runnable}.`;
    } else if (a?.ok) said = "No newer row on this gap yet.";
  }
  return said ? (
    <p className="sf-muted sf-row-note" data-after-verdict={after}>
      {said}
    </p>
  ) : null;
}

function Judge({ row, rowId, kind, graded, after, reading }: { row: Readonly<Record<string, unknown>>; rowId: string; kind: NonNullable<ViewEntry["judge"]>; graded?: ViewEntry["graded"]; after?: VerdictReader["after"]; reading: Pick<Reading, "enabled" | "intervalMs"> }): ReactNode {
  const session = useSession();
  const client = useQueryClient();
  const [verdict, setVerdict] = useState<Verdict>({ state: "idle" });
  const signedIn = session.data?.signedIn === true;
  const rightCounts = !(kind === "land" && row["truncated"] === true);
  const give = async (r: 0 | 1): Promise<void> => {
    setVerdict({ state: "sending", r });
    const got = kind === "land" ? await writeLandVerdict(row, r) : await writeOutcome(rowId, r);
    if (!got.ok && got.signedOut) {
      // The page still showed a sign-in the surface no longer holds (it restarted, or the
      // sign-in ran out): read the session again so the page says so everywhere.
      setVerdict({ state: "signedOut" });
      void client.invalidateQueries({ queryKey: SESSION_KEY });
      return;
    }
    setVerdict(got.ok ? { state: "done", r, seq: got.seq, id: got.id } : { state: "refused", reason: got.reason, said: got.said });
  };
  return (
    <>
    <div className="sf-row-judge" role="group" aria-label="Your verdict on this">
      {/* The verdict given is the marked word (aria-pressed); beside it, the record it was stored as. */}
      {verdict.state === "done" ? <span className="sf-judge-given">record #{verdict.seq}</span> : null}
      {!rightCounts ? <span className="sf-judge-given" data-right-needs-whole="" id={`whole-${rowId}`}>{RIGHT_NEEDS_WHOLE}</span> : null}
      <button type="button" className="sf-judge-word" aria-pressed={verdict.state === "done" && verdict.r === 1} disabled={!signedIn || verdict.state === "sending" || !rightCounts} aria-describedby={!rightCounts ? `whole-${rowId}` : undefined} title={!signedIn ? SIGN_IN_TO_JUDGE : !rightCounts ? RIGHT_NEEDS_WHOLE : verdict.state === "done" && verdict.r === 1 ? VERDICT_GIVEN : undefined} aria-label="Right" onClick={() => void give(1)}>
        <Glyph name="right" />
      </button>
      <button type="button" className="sf-judge-word" aria-pressed={verdict.state === "done" && verdict.r === 0} disabled={!signedIn || verdict.state === "sending"} title={!signedIn ? SIGN_IN_TO_JUDGE : verdict.state === "done" && verdict.r === 0 ? VERDICT_GIVEN : undefined} aria-label="Wrong" onClick={() => void give(0)}>
        <Glyph name="wrong" />
      </button>
    </div>
    {/* Under the row's line, so Right and Wrong keep their place beside the time. */}
    {verdict.state === "signedOut" ? (
      <p className="sf-row-note sf-judge-refused" role="alert" data-refused="">
        Your verdict was not recorded: you are no longer signed in (the surface may have restarted). Sign in with your key and judge again.
      </p>
    ) : null}
    {verdict.state === "refused" ? (
      <div className="sf-outcome-said sf-judge-refused" role="alert">
        <p className="sf-row-note" data-refused="">Not recorded: {verdict.reason}</p>
        <Said said={verdict.said} />
      </div>
    ) : null}
    {verdict.state === "done" && after ? <AfterVerdict after={after} row={row} mine={verdict.id} reading={reading} /> : null}
    {verdict.state === "done" && graded ? <SystemGrade graded={graded} row={row} reading={reading} /> : null}
    </>
  );
}

/**
 * The rows an entry draws: the answer, or the field of it the entry names, and with `show`
 * only the last n in the order the producer returned them; with `newest`, those n reversed, on a
 * copy, so the cut stays the producer's. `earlier` is what the cut left out, in the same order,
 * drawn folded rather than dropped. Null when there are no rows to draw, with what was found instead.
 */
export function rowsOf(answer: unknown, entry: Pick<ViewEntry, "field" | "show" | "newest">): { rows: readonly unknown[]; earlier: readonly unknown[]; total: number } | { missing: string; notRows?: true } {
  const at = entry.field === undefined ? answer : typeof answer === "object" && answer !== null && !Array.isArray(answer) ? (answer as Record<string, unknown>)[entry.field] : undefined;
  if (at === undefined || at === null) return { missing: entry.field === undefined ? "answered with nothing" : `the answer has no ${entry.field}` };
  // A read the view names with no field answers rows; anything else it answered is not one row of them.
  if (entry.field === undefined && !Array.isArray(at)) return { missing: "answered with something that is not rows", notRows: true };
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
 * An instant as an ISO string, and an identifier as a long run of hex with a letter in it, or a
 * UUID: what a value is, never which field holds it. A run of digits alone is a number.
 */
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const HEX_ID = /^(?:(?=\d*[a-f])[0-9a-f]{16,}|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/;

/** An id drawn as a short mark: the whole id is the element's text, so selecting it copies all of it; the style clips it. */
function ShortId({ id }: { id: string }): ReactNode {
  return (
    <code className="sf-row-id" title={id}>
      {id}
    </code>
  );
}

/**
 * One field's value in a row's details, drawn by what it is: an instant in the reader's zone (the
 * exact value on hover), an id as a short mark, several ids as their count folded over their marks,
 * an empty list as "none", anything else as its text.
 */
function FieldValue({ v }: { v: unknown }): ReactNode {
  if (typeof v === "string" && ISO_INSTANT.test(v) && !Number.isNaN(Date.parse(v))) {
    return (
      <time dateTime={v} title={v}>
        {when(v)}
      </time>
    );
  }
  if (typeof v === "string" && HEX_ID.test(v)) return <ShortId id={v} />;
  if (Array.isArray(v) && v.length === 0) return <span className="sf-muted">none</span>;
  if (Array.isArray(v) && v.every((x) => typeof x === "string" && HEX_ID.test(x))) {
    const ids = v as string[];
    if (ids.length === 1) return <ShortId id={ids[0]!} />;
    // Many ids are a count first: a walk's answer can cite a hundred rows.
    return (
      <details className="sf-row-ids-fold">
        <summary>{`${ids.length} ids`}</summary>
        <span className="sf-row-ids">
          {ids.map((x, i) => (
            <ShortId key={i} id={x} />
          ))}
        </span>
      </details>
    );
  }
  return fieldText(v);
}

/** A list of text that is not all ids: what a producer wrote one item at a time, such as steps. Details keep every field as one value. */
function isTextList(v: unknown): v is string[] {
  return Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "string") && !v.every((x) => HEX_ID.test(x as string));
}

/** A list of text, one item to a line, in the order its producer wrote them. */
function Items({ items }: { items: readonly string[] }): ReactNode {
  return (
    <ol className="sf-row-items">
      {items.map((x, i) => (
        <li key={i}>{x}</li>
      ))}
    </ol>
  );
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
 * which builds elements and draws markup and links as text; a list of text as its items, one to a
 * line; any other value as one line with its field's name.
 */
function Word({ k, v, cut }: { k: string; v: unknown; cut: boolean }): ReactNode {
  if (isTextList(v)) return <div className="sf-row-words"><Items items={v} /></div>;
  if (typeof v === "string" && heuristicForm(k, v, false) === "diff") return <DiffWord text={v} cut={cut} />;
  return typeof v === "string" ? (
    <div className="sf-row-words sf-row-prose">
      <Prose source={v} breaks />
    </div>
  ) : (
    <p className="sf-row-words">{`${k.replace(/_/g, " ")} ${fieldText(v)}`}</p>
  );
}

/**
 * A change, folded under its size: what it does is the row's headline, the change itself one tap
 * away. A change the producer cut short says so on the fold, so it is never read as the whole.
 */
function DiffWord({ text, cut }: { text: string; cut: boolean }): ReactNode {
  const { added, removed } = diffSize(parseDiff(text));
  return (
    <details className="sf-row-words sf-row-diff" data-diff="">
      <summary>
        {`the change · +${added} −${removed} lines`}
        {cut ? <span className="sf-row-diff-cut" data-cut="">{" · cut short: not the whole change"}</span> : null}
      </summary>
      <Diff text={text} />
    </details>
  );
}

/** `sectionStale`: the entry these rows belong to is drawn from a read that failed since; its note covers their threads. */
type Reading = { declared: ReadonlyMap<string, readonly string[]>; marks: ReadonlyMap<string, readonly MarkBinding[]>; readers: readonly VerdictReader[]; enabled: boolean; intervalMs: number; onOpenQuestion: (id: string) => void; openQuestion: string | null; sectionStale?: true };

/**
 * An entry's thread under one row: its read, bound to the row's id, drawn as its own entry.
 * Folded, it is one line of words under the row, its title and how many rows the read holds,
 * opened by the person: what the walk did with an ask is there to look into, not to read first.
 */
function Thread({ entry, row, rowId, reading }: { entry: ViewEntry; row: Readonly<Record<string, unknown>>; rowId: string; reading: Reading }): ReactNode {
  // Bound to the row by its id or a field of it; a row the binding names no value of draws no thread.
  const pointer = bindRow(entry.pointer, row);
  const q = useReport(pointer ?? { type: "record_read" }, { enabled: reading.enabled && pointer !== null, intervalMs: reading.intervalMs });
  if (pointer === null) return null;
  const a: ReportAnswer | undefined = q.data;
  const inner = !a ? (
    <p className="sf-muted sf-report-note">{q.isError ? "no answer: the read failed" : "reading…"}</p>
  ) : !a.ok ? (
    <Unanswered a={a} className="sf-muted sf-report-note" />
  ) : (
    <>
      {a.stale && !reading.sectionStale ? <Stale stale={a.stale} /> : null}
      <Drawn entry={entry} answer={a.answer} reading={reading} />
    </>
  );
  if (entry.folded) {
    const got = a?.ok ? rowsOf(a.answer, entry) : null;
    const count = got && "total" in got ? got.total : null;
    const title = entry.title ?? reportTitle(entry.pointer.type);
    // A read that holds nothing has nothing to open: its title and its 0, with no control that opens to nothing.
    if (count === 0) {
      return (
        <p className="sf-thread sf-thread-folded" data-thread-of={rowId} aria-label={title}>
          {title}
          <span className="sf-report-count" data-count={0}>0</span>
        </p>
      );
    }
    return (
      <details className="sf-thread sf-thread-folded" data-thread-of={rowId} aria-label={title}>
        <summary>
          {title}
          {count !== null ? <span className="sf-report-count" data-count={count}>{count}</span> : null}
          {a?.ok && a.stale && !reading.sectionStale ? <span className="sf-report-count" data-stale-mark="">not current</span> : null}
        </summary>
        {inner}
      </details>
    );
  }
  return (
    <div className="sf-thread" data-thread-of={rowId}>
      {inner}
    </div>
  );
}

/**
 * A change's `typecheck`, as the landing step wrote it, drawn above Right and Wrong so the person
 * sees it when they mark: each field in the row's own order, a short one on one line under its
 * name, a long one (the compiler's output) folded under its name and shown verbatim. The page adds
 * no sentence of its own: how a typecheck reads is the system's, changed by asking. It is shown,
 * never a gate; the person's mark decides.
 */
function Typecheck({ tc }: { tc: unknown }): ReactNode {
  if (typeof tc !== "object" || tc === null || Array.isArray(tc)) return null;
  const fields = Object.entries(tc as Record<string, unknown>);
  if (fields.length === 0) return null;
  return (
    <div className="sf-row-note sf-typecheck" data-typecheck="">
      {fields.map(([k, v]) => {
        const name = `typecheck ${k.replace(/_/g, " ")}`;
        const text = fieldText(v);
        return typeof v === "string" && (v.includes("\n") || v.length > 80) ? (
          <details key={k} className="sf-typecheck-long" data-field={k}>
            <summary>{name}</summary>
            <pre className="sf-typecheck-out">{text}</pre>
          </details>
        ) : (
          <p key={k} data-field={k}>{`${name} ${text}`}</p>
        );
      })}
    </div>
  );
}

/**
 * The states a row's declared fields read as: a dot in the state's colour, the declarer's word
 * for the field, the value as written, and the state's own word, so a state is never colour
 * alone and never stands in for the value. The field's name is the mark's title.
 */
function Marks({ marks }: { marks: ReturnType<typeof rowMarks> }): ReactNode {
  if (marks.length === 0) return null;
  return (
    <ul className="sf-state-marks">
      {marks.map((m) => (
        <li key={m.field} className="sf-state-mark" data-state={m.state} data-field={m.field} title={m.field}>
          <span className="sf-state-mark-dot" aria-hidden="true" />
          <span className="sf-state-mark-label">{m.label}</span>
          <span className="sf-state-mark-value">{fieldText(m.value)}</span>
          <span className="sf-state-mark-state">{STATE_TOKENS[m.state].label}</span>
        </li>
      ))}
    </ul>
  );
}

function Rows({ rows, entry, reading }: { rows: readonly unknown[]; entry: ViewEntry; reading: Reading }): ReactNode {
  const judge = entry.judge;
  const threads = threadsOf(entry);
  return (
    <ol className="sf-rows">
      {rows.map((row, i) => {
        const o: Record<string, unknown> = typeof row === "object" && row !== null && !Array.isArray(row) ? (row as Record<string, unknown>) : { value: row };
        const id = typeof o["id"] === "string" ? (o["id"] as string) : null;
        const words = rowWords(o, wordsFor(o["shape"], reading.declared, entry.words));
        const time = when(o["t"]);
        return (
          <li key={id ?? i} className={threads.length > 0 ? "sf-row sf-row-parent" : "sf-row"} data-row={id ?? undefined}>
            {words.length > 0 ? (
              words.map((w, j) => <Word key={j} k={w.field} v={w.value} cut={o["truncated"] === true} />)
            ) : (
              <p className="sf-row-words sf-muted">{typeof o["shape"] === "string" ? reportTitle(o["shape"]) : "a row"}</p>
            )}
            {judge === "land" ? <Typecheck tc={o["typecheck"]} /> : null}
            <Marks marks={rowMarks(o, marksFor(o["shape"], reading.marks, entry.marks))} />
            <div className="sf-row-meta">
              {/* The row's time is what opens its fields: one control, not a time and an arrow beside it. */}
              <details className="sf-row-details" data-by-time={time ? "" : undefined}>
                <summary aria-label={time ? `${time}: details` : undefined}>{time ? <RowTime t={o["t"] as string} full={time} /> : "details"}</summary>
                <dl className="sf-row-fields">
                  {Object.entries(o).map(([k, v]) => (
                    <div key={k} className="sf-row-field">
                      <dt>{k.replace(/_/g, " ")}</dt>
                      <dd>
                        <FieldValue v={v} />
                      </dd>
                    </div>
                  ))}
                </dl>
              </details>
              {judge && id && (entry.words === undefined || entry.words.some((f) => o[f] !== undefined && o[f] !== null && o[f] !== "")) ? <Judge row={o} rowId={id} kind={judge} graded={entry.graded} after={reading.readers.find((r) => r.judge === judge && r.shape === o["shape"])?.after} reading={reading} /> : null}
              {entry.about && id ? <AboutThis row={o} rowId={id} words={words.map((w) => fieldText(w.value)).join(" ").trim() || (typeof o["shape"] === "string" ? reportTitle(o["shape"]) : "this")} threads={threads} reading={reading} /> : null}
            </div>
            {id ? threads.map((t, j) => <Thread key={j} entry={t} row={o} rowId={id} reading={reading} />) : null}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * A control that only chooses what the box is about: a new ask about this row. The ask cites the
 * row, then the rows its judged thread drew under it (the answer the person sees), and only those
 * that cite this row (citesOf), so nothing undrawn and nothing from another ask is cited. It reads that
 * thread through the same query the thread itself drew from: no second read.
 */
function AboutThis({ row, rowId, words, threads, reading }: { row: Readonly<Record<string, unknown>>; rowId: string; words: string; threads: readonly ViewEntry[]; reading: Reading }): ReactNode {
  const judged = threads.find((t) => t.judge === "outcome");
  const pointer = judged ? bindRow(judged.pointer, row) : null;
  const q = useReport(pointer ?? { type: "record_read" }, { enabled: reading.enabled && pointer !== null, intervalMs: reading.intervalMs });
  const got = judged && q.data?.ok ? rowsOf(q.data.answer, judged) : null;
  const drawn = got && "rows" in got ? got.rows : [];
  return (
    <button type="button" className="sf-row-about" aria-label="Ask about this" title="Ask about this" onClick={() => askAbout({ cites: citesOf(rowId, drawn), words })}>
      <Glyph name="about" />
    </button>
  );
}

/**
 * Questions waiting on the person. One opens in place, under its row, with what answers it; the
 * rest of the landing stays in view. A question opened by a link that is not drawn here (gone
 * from the list, or among the earlier rows) opens above the list, and only there: the earlier
 * rows draw no card of their own, so one question never has two drafts.
 *
 * Each row is the measured element for exposure (the retired questions rail's were): a tick is
 * reported each time a different set of rows is put on screen.
 */
function Questions({ rows, open, onOpen, lead = false, inline = true }: { rows: readonly unknown[]; open: string | null; onOpen: (id: string) => void; lead?: boolean; inline?: boolean }): ReactNode {
  const policy = useRenderPolicy({ enabled: false, intervalMs: 0 }).data;
  const listRef = useRef<HTMLUListElement | null>(null);
  const ids = rows.map((row) => (typeof row === "object" && row !== null && typeof (row as Record<string, unknown>)["id"] === "string" ? ((row as Record<string, unknown>)["id"] as string) : null));
  const drawn = ids.join("\n");
  useEffect(() => {
    if (listRef.current && rows.length > 0) reportExposureTick(listRef.current, rows.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawn]);
  const elsewhere = lead && open !== null && !ids.includes(open);
  return (
    <>
      {elsewhere ? (
        <div className="sf-question-inplace" data-question-open={open}>
          <QuestionView questionId={open} />
        </div>
      ) : null}
      <ul className="sf-landing-list" ref={listRef}>
        {rows.map((row, i) => {
          const id = ids[i] ?? null;
          // A row here is a question this surface holds, so it is named by its subject.
          const name = id ? questionRowSubject(row as Question) || itemName(row) : itemName(row);
          const isOpen = id !== null && id === open;
          return (
            <li key={id ?? i}>
              {id ? (
                <>
                  <button
                    type="button"
                    className="sf-landing-row"
                    aria-expanded={isOpen}
                    data-solicitation-id={id}
                    data-exposure-role="list_row"
                    // The form the open question draws its body in: the form learner's evidence, read off this row at act time.
                    data-form={planFor(fromPanel(QUESTION_CONTENT_SHAPE, (row as Question).body), policy).form}
                    data-form-shape={QUESTION_CONTENT_SHAPE}
                    onClick={() => onOpen(id)}
                  >
                    <span className="sf-landing-text">{name}</span>
                  </button>
                  {isOpen && inline ? (
                    <div className="sf-question-inplace" data-question-open={id}>
                      <QuestionView questionId={id} inPlace />
                    </div>
                  ) : null}
                </>
              ) : (
                <span className="sf-landing-text">{name}</span>
              )}
            </li>
          );
        })}
      </ul>
    </>
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
 * reason folded under "why"; else the producer's reason, as written; else nothing. The page adds no
 * sentence of its own: an entry's title carries its count, 0 included, so an empty one says so by
 * its form. The reason is never dropped, only placed behind the view's words.
 */
function Empty({ said, why }: { said: string | undefined; why: string | null }): ReactNode {
  if (said === undefined) return why === null ? null : <p className="sf-muted sf-report-note">{why}</p>;
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
  if ("missing" in got) {
    return (
      <>
        <p className="sf-muted sf-report-note">{got.missing}</p>
        {got.notRows ? (
          <details className="sf-row-details" data-not-rows="">
            <summary>details</summary>
            <FieldValue v={answer} />
          </details>
        ) : null}
      </>
    );
  }
  // A thread under a row with nothing citing it and no words for that says nothing: an ask the walk made no change for has no line about changes.
  if (got.rows.length === 0) return <Empty said={entry.empty} why={emptyReasonOf(answer)} />;
  const draw = (rows: readonly unknown[]): ReactNode =>
    entry.form === "questions" ? <Questions rows={rows} open={reading.openQuestion} onOpen={reading.onOpenQuestion} inline={false} /> : <Rows rows={rows} entry={entry} reading={reading} />;
  return (
    <>
      {entry.form === "questions" ? <Questions rows={got.rows} open={reading.openQuestion} onOpen={reading.onOpenQuestion} lead /> : draw(got.rows)}
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

/**
 * Rows kept after a read failed: when the rows drawn were read, that the latest read failed (and
 * how many in a row), and the failure's own words folded under "why". Words the page owns; the
 * failure is the transport's or the producer's, passed on as it came.
 */
function Stale({ stale }: { stale: NonNullable<Extract<ReportAnswer, { ok: true }>["stale"]> }): ReactNode {
  const iso = new Date(stale.since).toISOString();
  return (
    <div className="sf-muted sf-report-note sf-stale" data-stale="" role="status">
      <span>
        Showing the read from <time dateTime={iso} title={new Date(stale.since).toLocaleString(undefined, WHEN)}>{relative(stale.since)}</time>; the latest read failed{stale.misses > 1 ? ` (${stale.misses} in a row)` : ""}.
      </span>{" "}
      <details className="sf-stale-why">
        <summary>why</summary>
        <span data-stale-reason="">{stale.reason}</span>
      </details>
    </div>
  );
}

function hasRows(a: ReportAnswer | undefined, entry: ViewEntry): boolean {
  const got = a?.ok && entry.form !== "fields" ? rowsOf(a.answer, entry) : null;
  return got !== null && "total" in got && got.total > 0;
}

function Entry({ entry, reading }: { entry: ViewEntry; reading: Reading }): ReactNode {
  const pointer = entry.pointer;
  const q = useReport(pointer, { enabled: reading.enabled, intervalMs: reading.intervalMs });
  const title = entry.title ?? reportTitle(pointer.type);
  const a: ReportAnswer | undefined = q.data;
  let inner: ReactNode;
  if (!a) inner = <p className="sf-muted sf-report-note">{q.isError ? "no answer: the read failed" : "reading…"}</p>;
  else if (!a.ok && a.signIn) inner = null;
  else if (!a.ok && a.refused) inner = <p className="sf-report-note" data-refused="">Not read: {a.reason}</p>;
  else if (!a.ok) inner = <p className="sf-muted sf-report-note">no answer: {a.reason}</p>;
  else inner = <Drawn entry={entry} answer={a.answer} reading={a.stale ? { ...reading, sectionStale: true } : reading} />;
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
          {a && !a.ok ? a.signIn ? <span className="sf-report-count" data-sign-in-to-see="">{SIGN_IN_TO_SEE}</span> : a.refused ? <span className="sf-report-count" data-refused="">not read</span> : <span className="sf-report-count" data-no-answer="">no answer</span> : null}
          {a?.ok && a.stale ? <span className="sf-report-count" data-stale-mark="">not current</span> : null}
        </summary>
        {a?.ok && a.stale ? <Stale stale={a.stale} /> : null}
        {inner}
      </details>
    );
  }
  // Drawn open, an entry whose read holds no rows carries its count as a folded one does: 0.
  const none = a?.ok === true && entry.form !== "fields" && ((got) => "total" in got && got.total === 0)(rowsOf(a.answer, entry));
  return (
    <section className="sf-report" data-report={pointer.type} data-form={entry.form} data-empty={none ? "" : undefined} aria-label={title}>
      <h2 className="sf-report-title">
        {title}
        {none ? <span className="sf-report-count" data-count={0}>0</span> : null}
        {a && !a.ok && a.signIn ? <span className="sf-report-count" data-sign-in-to-see="">{SIGN_IN_TO_SEE}</span> : null}
      </h2>
      {/* What the rows are for, under the title; with no rows there is nothing to act on, so it is not drawn. */}
      {entry.note && hasRows(a, entry) ? <p className="sf-report-lede" data-note="">{entry.note}</p> : null}
      {a?.ok && a.stale ? <Stale stale={a.stale} /> : null}
      {inner}
    </section>
  );
}

export function Entries({
  entries,
  readers = [],
  enabled,
  intervalMs,
  onOpenQuestion,
  openQuestion = null,
}: {
  entries: readonly ViewEntry[];
  readers?: readonly VerdictReader[];
  enabled: boolean;
  intervalMs: number;
  /** Opens a question in place, or closes it when it is the open one. */
  onOpenQuestion: (id: string) => void;
  /** The question open in place, if any. */
  openQuestion?: string | null;
}): ReactNode {
  // Read on the entries' cadence, so a declaration an owner writes later moves what is shown with no reload.
  const declarations = useReport(DECLARATIONS, { enabled, intervalMs }).data;
  const declared = declarations?.ok ? declaredWords(declarations.answer) : new Map<string, readonly string[]>();
  const marks = declarations?.ok ? declaredMarks(declarations.answer) : new Map<string, readonly MarkBinding[]>();
  const reading: Reading = { declared, marks, readers, enabled, intervalMs, onOpenQuestion, openQuestion };
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
