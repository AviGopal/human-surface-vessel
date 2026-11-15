/**
 * Views for the surface's regions: what a region draws, in what order. A view is a list of
 * entries, each a pointer read through discovery and the form its answer is drawn in; the
 * surface names no section of its own. A view is written through `uiView_write` by anything
 * that can author an impulse, a learned activity included, and the region draws the
 * newest valid one at use time. With none written, a region draws its default.
 *
 * The vocabulary is closed: an entry names only forms the surface can draw, and a
 * write naming anything else is refused with a named reason and stores nothing. So
 * nothing the system writes reaches the screen unchecked, and a refusal is
 * machine-readable for whoever wrote it.
 *
 * The surface serves `uiView_write`, and never advertises `uiView`: a view is
 * produced by whatever writes it, and the surface is where views are kept and drawn.
 *
 * Durable as an append-only file under WORKSPACE_ROOT/state/, like the surface's own
 * record of asks: each line is one revision of one region, and the newest line per
 * region is in force. "undo" appends the previous revision's view again as a new
 * revision, so the log stays append-only and every change, undo included, is named.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { FIELD_NAME, MAX_WORDS, wordFields } from "./row-words.ts";

/**
 * The regions a view can be written for. A person's ask is followed where it is listed, as a
 * thread on the landing: nothing is drawn under the box after it, so there is no `ask` region.
 */
export const VIEW_REGIONS = ["landing"] as const;
/**
 * In an entry's `thread`, a pointer argument written as ROW_BINDING stands for the id of the row
 * the thread is drawn under: the one value the page knows per row and a view's writer cannot.
 */
export const ROW_BINDING = "$row";

export type ViewRegion = (typeof VIEW_REGIONS)[number];

/**
 * What an entry reads: a pointer resolved through discovery, with the shape in `type` and
 * any arguments as plain values. Whatever serves the shape answers; the surface draws the
 * answer and does not interpret it.
 */
/** A read's pointer: plain arguments, and at most records' `where` ({field: value}, by equality). */
export type ReportPointer = Readonly<Record<string, string | number | boolean | Readonly<Record<string, string | number | boolean>>>> & { readonly type: string };

/**
 * The forms an answer can be drawn in. `fields`: its plain values, and each list as its size
 * and first items. `rows`: each row with every field in full. `questions`: each row is a
 * question this surface holds, drawn as its title and opened on selection.
 */
export const ENTRY_FORMS = ["fields", "rows", "questions"] as const;
export type EntryForm = (typeof ENTRY_FORMS)[number];

/**
 * One thing a view draws: a pointer, and how to draw its answer. Only the pointer is sent.
 * `title` is the writer's words for it; with none, the shape's name is shown. `field` names
 * the field of the answer that holds its rows, when the rows are not the answer itself.
 * `show` draws only the last n rows, in the order the producer returned them.
 * `judge: "outcome"` offers a person's verdict on each row, written as an outcome row
 * citing it under the person's own key; with `words` named, only on a row that holds one of
 * them, so a row with nothing to judge offers no verdict. `judge: "land"` offers the same on a
 * change, written as a land_verdict row citing it and carrying the row's own `repo` and `tree`,
 * the keys a landing reads verdicts by. Which changes may land on it is the landing's to decide:
 * the page offers the verdict on every row the view judges, and refuses nothing. `empty` is what the entry says when the read answers
 * with no rows, so an empty read carries its reason rather than a bare "no rows". `note` is one
 * short line under the title of an entry drawn open (not folded, not in a thread), drawn only while
 * the read has rows: what the rows are for, so the title can stay a name.
 * `words` names the fields that hold a row's words, in order, for a row whose shape has no
 * `shape_description` row declaring them (the owner's declaration comes first); a row with
 * neither is drawn as its shape and time, every field folded.
 * `thread` is one further read drawn under each row (form "rows" only), its pointer bound to
 * that row's id through ROW_BINDING: a person's ask shows what cites it. It is an entry itself,
 * with its own `show` (the per-row limit), `words`, `judge` and `empty`, and holds no thread of
 * its own: one level. Which rows it holds is its pointer's, so the producer's. It may be a list
 * of up to MAX_THREADS such entries, each read on its own and drawn in the list's order: an
 * ask's answer, which carries the verdict, and beside it another account of the same ask.
 * `newest: true` (form "rows" only) draws the rows `show` kept in reverse of the producer's
 * order: the cut is still the producer's last n, and the page sorts by nothing.
 * `folded: true` draws the entry closed under its title and the count of rows its read holds:
 * the evidence behind one control, never hidden uncounted.
 * `strip: {hours}` (folded entries only) draws, in the fold's summary, how many of the rows its
 * read returned fall in each of the last `hours` hours, by their `t`: a picture of when, from
 * rows already read, never a second read. When the read was cut to its newest rows and they do
 * not reach back to the window's start, the strip says so instead of looking whole.
 * `graded` (with a `judge` only) is the read of the system's own grades of a row, its
 * pointer bound to the row through ROW_BINDING and narrowed by records' `where` (equality on a
 * row's fields; records stamps `role` from the writer's key). It is drawn only after this person
 * has given their verdict on the row, closed, so the system's grade cannot anchor the person's.
 * `about: true` (form "rows", not in a thread) offers on each row a control that sets the one box
 * to a new ask about that row: the ask cites it, and the rows its judged thread drew under it. The
 * control only chooses what the box is about; the box stays the one input.
 */
export type ViewEntry = {
  readonly pointer: ReportPointer;
  readonly form: EntryForm;
  readonly title?: string;
  readonly field?: string;
  readonly show?: number;
  readonly judge?: JudgeKind;
  readonly empty?: string;
  readonly note?: string;
  readonly words?: readonly string[];
  readonly thread?: ViewEntry | readonly ViewEntry[];
  readonly newest?: true;
  readonly folded?: true;
  readonly strip?: { readonly hours: number };
  readonly graded?: GradedRead;
  readonly about?: true;
};

type Plain = string | number | boolean;
/** A row's grades as a read: a pointer bound to the row, with records' `where` by equality. */
export type GradedRead = { readonly pointer: Readonly<Record<string, Plain | Readonly<Record<string, Plain>>>> & { readonly type: string } };

/** What a person's verdict on a row is written as: an outcome on an answer or a check, a land_verdict on a change. */
export const JUDGE_KINDS = ["outcome", "land"] as const;
export type JudgeKind = (typeof JUDGE_KINDS)[number];

/**
 * Who reads a person's verdict, by what it is written as and the shape of the row it judges, and
 * which fields a row needs for that reader to read it. A view offers a verdict only where one of
 * these reads it (the reachability test holds the default to it), and the page shows, under a
 * verdict given, the one fact that reader leaves: records' standing of the grade, or the gap's
 * newer detector row, or only the record it was stored as when the reader leaves none a read
 * can reach. Served with the view, so the page reads it at use time and keeps no copy.
 */
export type VerdictReader = {
  readonly judge: JudgeKind;
  readonly shape: string;
  readonly read_by: string;
  readonly needs: Readonly<Record<string, Plain>>;
  readonly after: "standing" | "gap" | "record";
};
export const VERDICT_READERS: readonly VerdictReader[] = [
  { judge: "outcome", shape: "answer", read_by: "records' fold, as a person's grade of a described answer", needs: { role: "described" }, after: "standing" },
  // The release reads a person's verdict only on a gap held for one, or marked before. Until the gap row says so in
  // a field records can match (waits_for, the coordinator's gap), the default cannot narrow its read to those.
  { judge: "outcome", shape: "gap", read_by: "pull-sync's release of a gap held for a person", needs: { waits_for: "person" }, after: "gap" },
  // git_land's answer is a failure row naming the tree inside its body, which no read can match: only the record shows.
  { judge: "land", shape: "gitDiff", read_by: "git_land, by the change's tree", needs: { role: "walk" }, after: "record" },
];

/** How many entries one view may name, and how many rows `show` may ask for. */
const MAX_ENTRIES = 8;
const MAX_SHOW = 200;
/** How many reads an entry's `thread` may list under each row. */
export const MAX_THREADS = 3;
/** The widest window a strip may draw: a week, an hour per bar. */
const MAX_STRIP_HOURS = 168;
const SHAPE_NAME = /^[A-Za-z][A-Za-z0-9_:.-]{0,79}$/;

/**
 * What a region draws with no view written, in the order the person needs it: what waits on
 * them, then what changed. How the system is doing has no answer a bare pointer can read yet
 * (the walk's posterior needs a list of cells, which a view argument cannot carry), so it is
 * not named until something serves it. Every pointer only reads, so
 * drawing the screen never acts on the system; a view the system writes replaces the list.
 */
/** How many fields a `graded` read's `where` may match on. */
const MAX_WHERE = 4;

/**
 * The walk's own grades of a row: outcomes citing it that the described-shape vessel wrote, which
 * records stamps with role "described". A person's outcome carries role "person" and is not read.
 */
/** The folded reads draw when their rows came, over the last day. */
const DAY = { hours: 24 } as const;

const WALK_GRADES: GradedRead = { pointer: { type: "record_read", refs_to: ROW_BINDING, shape: "outcome", where: { role: "described" } } };
/** The walk's own grades of a change: land_verdicts citing it that the described-shape vessel wrote. */
const LAND_GRADES: GradedRead = { pointer: { type: "record_read", refs_to: ROW_BINDING, shape: "land_verdict", where: { role: "described" } } };

export const DEFAULT_VIEWS: Record<ViewRegion, { entries: readonly ViewEntry[] }> = {
  landing: {
    entries: [
      { pointer: { type: "uiQuestion", open: true }, form: "questions", field: "questions", title: "Waiting on you", empty: "Nothing is waiting on you." },
      // A detector's gap that states a `claim` (the test is right) can be judged: the person's Right or Wrong
      // on a held one is read where holds are lifted. Records answers each gap's latest row, open, holding a
      // claim; the newest three are drawn. Records cannot yet say which are held for a person (the hold is
      // in each row's meta), so its note says what a verdict does on a held one rather than calling them all held.
      { pointer: { type: "record_read", shape: "gap", latest_by: "gap_id", where: { status: "open" }, has: "claim" }, form: "rows", show: 3, newest: true, words: ["claim"], judge: "outcome", title: "Failing checks", note: "Right releases a held one; Wrong marks its test wrong.", empty: "No check is failing." },
      {
        pointer: { type: "record_read", shape: "world_changed" },
        form: "rows",
        // Three, so the folded reads under the asks start on the first screen; the rest are "N earlier".
        show: 3,
        newest: true,
        title: "What people asked",
        words: ["what"],
        // Each ask offers to set the box to a new ask about it, citing it and its answer.
        about: true,
        // Under each ask, its answer first: a read records filters by shape, not a choice the page makes.
        // Then what the walk did with it, records' calls under that root, folded and counted: there
        // to look into, not to read before the answer. Its order and its cut are records'.
        thread: [
          { pointer: { type: "record_read", refs_to: ROW_BINDING, shape: "answer", where: { role: "described" } }, form: "rows", show: 1, newest: true, words: ["text"], judge: "outcome", graded: WALK_GRADES, empty: "Not answered yet." },
          // Then the change the walk made for it, if any: its newest diff, judged under the ask it was
          // made for, the grader's verdict closed until the person's. Where the landing stands is in
          // what the walk did (its landing calls), not a second read here.
          { pointer: { type: "record_read", refs_to: ROW_BINDING, shape: "gitDiff", where: { role: "walk" } }, form: "rows", show: 1, newest: true, words: ["repo", "diff"], judge: "land", graded: LAND_GRADES },
          { pointer: { type: "record_read", root: ROW_BINDING, calls: "all", output: false }, form: "rows", show: 12, words: ["type", "state"], title: "What the walk did", folded: true },
        ],
      },
      // The raw reads, folded and counted under the asks. A line of how the system is doing comes
      // back only with a live writer of what it shows: a read nothing writes is a fossil.
      { pointer: { type: "record_read", shape: "answer", where: { role: "described" } }, form: "rows", show: 10, newest: true, judge: "outcome", graded: WALK_GRADES, title: "What the walk answered", words: ["text"], folded: true, strip: DAY },
      { pointer: { type: "record_read", shape: "failure" }, form: "rows", show: 10, newest: true, title: "What failed", folded: true, strip: DAY },
      { pointer: { type: "record_read", shape: "outcome" }, form: "rows", show: 10, newest: true, title: "Verdicts and outcomes", words: ["r"], folded: true, strip: DAY },
    ],
  },
};

/** The contract a region's views are checked against, and what discovery is told about it. */
export interface ViewContract {
  readonly regions: readonly string[];
  readonly defaults: Readonly<Record<string, { entries: readonly ViewEntry[] }>>;
}

const CONTRACT: ViewContract = { regions: VIEW_REGIONS, defaults: DEFAULT_VIEWS };

/**
 * What discovery is told about the view shapes, generated from the contract above, so a
 * goal is matched against the vocabulary a write is actually checked against and the
 * description cannot drift from it.
 */
export function viewShapeDescriptions(contract: ViewContract = CONTRACT): Record<"uiView_write" | "human_surface:ui_view", string> {
  const names = contract.regions.join(", ");
  const entry =
    `entries is a list of 1 to ${MAX_ENTRIES} {pointer: {type, ...plain arguments, where?: {field: value} (equality, 1 to ${MAX_WHERE} fields)}, form: ${ENTRY_FORMS.join(" | ")}, title?, field?, show?: 1..${MAX_SHOW}, judge?: ${JUDGE_KINDS.map((k) => `"${k}"`).join(" | ")}, empty?, note?, words?: [1 to ${MAX_WORDS} field names], thread?: an entry with no thread, or a list of 1 to ${MAX_THREADS} of them, newest?: true, folded?: true, strip?: {hours: 1..${MAX_STRIP_HOURS}}, graded?: {pointer}, about?: true}, ` +
    `drawn top to bottom in list order; a pointer is never a _write shape. form fields draws an answer's plain values; rows draws each row in full; ` +
    `questions draws each row as a question the surface holds. field names the answer's field holding the rows; show draws the last n rows as the producer ordered them; ` +
    `judge (rows only) offers a person's verdict on each row: "outcome" writes an outcome citing it, "land" a land_verdict citing it with the row's repo and tree; empty is what the entry says when the read has no rows, ahead of the producer's own reason, which is folded under it; note (1 to 120 characters, an entry drawn open only) is one line under its title, drawn while the read has rows; ` +
    `words names the fields drawn as a row's words when its shape's shape_description row (records, written by the owner) names none in its own words field; ` +
    `a row with neither is drawn as its shape and time, every other field folded under details; ` +
    `newest: true (rows only) draws the rows show kept newest first, the reverse of the producer's order, which also decides which rows are kept; ` +
    `folded: true draws the entry closed under its title and the count of rows its read holds; ` +
    `strip (folded only) draws in that summary how many of the rows read fall in each of the last hours hours, by their t; ` +
    `graded (with a judge only) is the read of the system's own grades of a row, its pointer naming "${ROW_BINDING}" and narrowed by where: {field: value} (equality, 1 to ${MAX_WHERE} fields), drawn closed only after the person has given their verdict on that row; ` +
    `thread (rows only) is read again under each row, its pointer argument "${ROW_BINDING}" replaced by that row's id, and drawn as its own entry, one level deep; a list is read entry by entry and drawn in list order; ` +
    `about: true (rows only, not in a thread) offers on each row a control that sets the person's box to a new ask about that row, citing it and the rows its judged thread drew under it`;
  const defaults = contract.regions
    .map((r) => `default ${r}: ${(contract.defaults[r]?.entries ?? []).map((e) => e.title ?? e.pointer.type).join(", ")}`)
    .join(". ");
  return {
    uiView_write:
      `writes the view of a human surface region (${names}): {region, entries, note?}. ${entry}. ${defaults}. ` +
      `a write naming the view already in force succeeds as unchanged and writes no revision; ` +
      `undo restores the view in force before the current one; read back in human_surface:ui_view`,
    "human_surface:ui_view":
      `reads what the human surface draws now: for each region (${names}) the view in force, its entries in draw order, ` +
      `revision and writer, and a stored view that is not drawn with the reason it was refused. Views are written by uiView_write`,
  };
}

/** Why a write stored nothing. Closed, so the writer can act on it without parsing prose. */
export type ViewRefusal = "unknown_region" | "unknown_field" | "bad_entry" | "nothing_to_undo";

export interface UiView {
  readonly region: ViewRegion;
  /** 1 for the first view written for the region; the default is revision 0. */
  readonly revision: number;
  /** `<region>@<revision>`: what a report names when it says which view it drew. */
  readonly id: string;
  /** What the region draws, in order. */
  readonly entries: readonly ViewEntry[];
  readonly note: string | null;
  /** The caller label the write door admitted; never a key. */
  readonly writtenBy: string | null;
  /**
   * The run the write says it came from, as its pointer names it: a walk puts its
   * dispatch and execution ids on the impulses its steps send, and a template step its
   * template or activity id. The caller is authenticated; these ids are what it claims.
   * Null for a write that names none.
   */
  readonly run: ViewRun | null;
  readonly writtenAt: number;
  /** On a revision written by "undo": the revision whose view it restored (0 = the default). */
  readonly undoOf: number | null;
}

/**
 * A stored view newer than the one in force that is not drawn, because what it names is no
 * longer something this surface draws. The page says so instead of silently drawing the
 * view before it.
 */
export interface NotDrawn {
  readonly id: string;
  readonly refusal: ViewRefusal;
  readonly detail: string;
}

/** The view in force, and the newest stored view that was passed over, if any. */
export type ViewInForce = UiView & { readonly notDrawn: NotDrawn | null; readonly readers: readonly VerdictReader[] };

export interface ViewRun {
  readonly dispatchId: string | null;
  readonly executionId: string | null;
  readonly templateId: string | null;
}

/** The run ids a pointer names, in either spelling the fleet writes; null when it names none. */
export function runOf(pointer: Record<string, unknown>): ViewRun | null {
  const pick = (...keys: string[]): string | null => {
    for (const k of keys) {
      const v = pointer[k];
      if (typeof v === "string" && v.trim()) return v.trim().slice(0, 200);
    }
    return null;
  };
  const run = {
    dispatchId: pick("dispatch_id", "dispatchId"),
    executionId: pick("execution_id", "executionId", "parent_execution_id"),
    templateId: pick("template_id", "templateId", "activity_id", "activityId"),
  };
  return run.dispatchId || run.executionId || run.templateId ? run : null;
}

export type ViewWrite =
  /** `unchanged`: the write named exactly the view in force; nothing was written and `view` is that view. */
  | { ok: true; view: UiView; unchanged?: true }
  | { ok: false; refusal: ViewRefusal; detail: string };

const root = (): string => process.env.WORKSPACE_ROOT ?? "/workspace";
const file = (): string => join(root(), "state", "human-surface", "ui-views.jsonl");

/** Every revision per region, oldest first. */
const history = new Map<ViewRegion, UiView[]>();
/** Per region, the newest stored view that is refused today, when it is newer than every drawable one. */
const passedOver = new Map<ViewRegion, NotDrawn>();
let loadedFrom: string | null = null;

function isRegion(v: unknown): v is ViewRegion {
  return typeof v === "string" && (VIEW_REGIONS as readonly string[]).includes(v);
}

function load(): void {
  const f = file();
  if (loadedFrom === f) return;
  loadedFrom = f;
  history.clear();
  passedOver.clear();
  if (!existsSync(f)) return;
  for (const line of readFileSync(f, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let v: Record<string, unknown>;
    try {
      v = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    const region = v["region"];
    const revision = v["revision"];
    if (!isRegion(region) || typeof revision !== "number" || !Number.isInteger(revision) || revision < 1) continue;
    // A line that would be refused today is not drawn: the file never widens the vocabulary.
    // It is remembered, so the page can say which view it passed over and why.
    const checked = validate({ region, entries: v["entries"], blocks: v["blocks"], limits: v["limits"], reports: v["reports"] });
    if (!checked.ok) {
      passedOver.set(region, { id: `${region}@${revision}`, refusal: checked.refusal, detail: checked.detail });
      continue;
    }
    passedOver.delete(region);
    const list = history.get(region) ?? [];
    list.push({ ...(v as unknown as UiView), entries: checked.entries });
    history.set(region, list);
  }
}

/** One entry as written, or why it is not one. */
function entryOf(e: unknown, inThread = false): { entry: ViewEntry } | { detail: string } {
  if (typeof e !== "object" || e === null || Array.isArray(e)) return { detail: "each entry is {pointer, form}" };
  const { pointer, form, title, field, show, judge, empty, note, words, thread, newest, folded, strip, graded, about, ...rest } = e as Record<string, unknown>;
  if (Object.keys(rest).length > 0) return { detail: `${Object.keys(rest).join(", ")}: an entry has pointer, form, title, field, show, judge, empty, note, words, thread, newest, folded, strip, graded and about only` };
  const got = pointerOf(pointer);
  if ("detail" in got) return got;
  const bound = Object.values(got.pointer).includes(ROW_BINDING);
  if (inThread && !bound) return { detail: `thread: its pointer names "${ROW_BINDING}", the row it is drawn under` };
  if (!inThread && bound) return { detail: `${ROW_BINDING}: only a thread's pointer is bound to a row` };
  if (inThread && thread !== undefined) return { detail: "thread: one level only" };
  if (typeof form !== "string" || !(ENTRY_FORMS as readonly string[]).includes(form)) return { detail: `form: ${ENTRY_FORMS.join(", ")}` };
  if (title !== undefined && (typeof title !== "string" || !title.trim() || title.length > 80)) return { detail: "title: 1 to 80 characters" };
  if (field !== undefined && (typeof field !== "string" || !FIELD_NAME.test(field))) return { detail: "field: a field name" };
  if (show !== undefined && (typeof show !== "number" || !Number.isInteger(show) || show < 1 || show > MAX_SHOW)) return { detail: `show: 1..${MAX_SHOW}` };
  if (judge !== undefined && !(JUDGE_KINDS as readonly unknown[]).includes(judge)) return { detail: `judge: ${JUDGE_KINDS.map((k) => `"${k}"`).join(" or ")}` };
  if (judge !== undefined && form !== "rows") return { detail: `judge needs form "rows": a verdict is on a row` };
  if (empty !== undefined && (typeof empty !== "string" || !empty.trim() || empty.length > 160)) return { detail: "empty: 1 to 160 characters" };
  if (note !== undefined && (typeof note !== "string" || !note.trim() || note.length > 120)) return { detail: "note: 1 to 120 characters" };
  if (note !== undefined && (inThread || folded !== undefined)) return { detail: "note: on an entry drawn open, not folded or in a thread: it is drawn under the open entry's title" };
  if (words !== undefined && !wordFields(words)) return { detail: `words: 1 to ${MAX_WORDS} field names` };
  if (words !== undefined && form !== "rows") return { detail: `words needs form "rows": words are a row's` };
  if (thread !== undefined && form !== "rows") return { detail: `thread needs form "rows": a thread is under a row` };
  if (newest !== undefined && newest !== true) return { detail: "newest: true" };
  if (newest !== undefined && form !== "rows") return { detail: `newest needs form "rows": it reverses the rows drawn` };
  if (folded !== undefined && folded !== true) return { detail: "folded: true" };
  if (strip !== undefined && folded !== true) return { detail: "strip needs folded: true: it is drawn in the fold's summary" };
  const hours = typeof strip === "object" && strip !== null && !Array.isArray(strip) ? (strip as Record<string, unknown>)["hours"] : undefined;
  if (strip !== undefined && (Object.keys(strip as object).length !== 1 || typeof hours !== "number" || !Number.isInteger(hours) || hours < 1 || hours > MAX_STRIP_HOURS)) return { detail: `strip: {hours: 1..${MAX_STRIP_HOURS}}` };
  if (about !== undefined && about !== true) return { detail: "about: true" };
  if (about !== undefined && form !== "rows") return { detail: `about needs form "rows": an ask is about a row` };
  if (about !== undefined && inThread) return { detail: "about: on a listed row, not in a thread" };
  if (graded !== undefined && judge === undefined) return { detail: `graded needs a judge: the system's grade is drawn after a person's verdict` };
  const grades = graded === undefined ? null : gradedOf(graded);
  if (grades && "detail" in grades) return grades;
  const listed = Array.isArray(thread);
  if (listed && (thread.length < 1 || thread.length > MAX_THREADS)) return { detail: `thread: one entry or a list of 1 to ${MAX_THREADS}` };
  const unders = thread === undefined ? [] : (listed ? thread : [thread]).map((t) => entryOf(t, true));
  const bad = unders.find((u) => "detail" in u);
  if (bad) return bad;
  const under = unders.map((u) => (u as { entry: ViewEntry }).entry);
  return {
    entry: {
      pointer: got.pointer,
      form: form as EntryForm,
      ...(typeof title === "string" ? { title: title.trim() } : {}),
      ...(typeof field === "string" ? { field } : {}),
      ...(typeof show === "number" ? { show } : {}),
      ...(judge !== undefined ? { judge: judge as JudgeKind } : {}),
      ...(typeof empty === "string" ? { empty: empty.trim() } : {}),
      ...(typeof note === "string" ? { note: note.trim() } : {}),
      ...(words !== undefined ? { words: words as string[] } : {}),
      ...(under.length > 0 ? { thread: listed ? under : under[0]! } : {}),
      ...(newest === true ? { newest } : {}),
      ...(folded === true ? { folded } : {}),
      ...(typeof hours === "number" ? { strip: { hours } } : {}),
      ...(grades ? { graded: grades.graded } : {}),
      ...(about === true ? { about } : {}),
    },
  };
}

/** An entry's `graded` as written, or why it is not one. */
function gradedOf(g: unknown): { graded: GradedRead } | { detail: string } {
  if (typeof g !== "object" || g === null || Array.isArray(g)) return { detail: "graded is {pointer}" };
  const { pointer, ...rest } = g as Record<string, unknown>;
  if (Object.keys(rest).length > 0) return { detail: `${Object.keys(rest).join(", ")}: graded is {pointer}` };
  if (typeof pointer !== "object" || pointer === null || Array.isArray(pointer)) return { detail: "graded is {pointer}" };
  const got = pointerOf(pointer);
  if ("detail" in got) return got;
  if (!Object.values(got.pointer).includes(ROW_BINDING)) return { detail: `graded: its pointer names "${ROW_BINDING}", the row it grades` };
  return { graded: { pointer: got.pointer } };
}

/** Plain arguments, and at most a `where` of 1 to MAX_WHERE fields, each a plain value: records' equality filter. */
function pointerOf(r: unknown): { pointer: ReportPointer } | { detail: string } {
  if (typeof r !== "object" || r === null || Array.isArray(r)) return { detail: "pointer is an object with a type" };
  const { where, ...args } = r as Record<string, unknown>;
  const out: Record<string, Plain | Record<string, Plain>> = {};
  for (const [k, v] of Object.entries(args)) {
    if (typeof v !== "string" && typeof v !== "number" && typeof v !== "boolean") return { detail: `${k}: arguments are plain values` };
    out[k] = v;
  }
  const type = out["type"];
  if (typeof type !== "string" || !SHAPE_NAME.test(type)) return { detail: `type: a shape name` };
  // Drawing the screen must not write anything, and a _write shape is a write by name.
  if (type.endsWith("_write")) return { detail: `${type}: a view only reads` };
  if (where !== undefined) {
    const fields = typeof where === "object" && where !== null && !Array.isArray(where) ? Object.entries(where as Record<string, unknown>) : [];
    const plain = fields.length >= 1 && fields.length <= MAX_WHERE && fields.every(([k, v]) => FIELD_NAME.test(k) && (typeof v === "string" || typeof v === "number" || typeof v === "boolean"));
    if (!plain) return { detail: `where: 1 to ${MAX_WHERE} fields, each a plain value` };
    out["where"] = where as Record<string, Plain>;
  }
  return { pointer: out as ReportPointer };
}

type Checked = { ok: true; entries: readonly ViewEntry[] } | { ok: false; refusal: ViewRefusal; detail: string };

function validate(input: { region: unknown; entries: unknown; blocks?: unknown; limits?: unknown; reports?: unknown }): Checked {
  if (!isRegion(input.region)) return { ok: false, refusal: "unknown_region", detail: `regions: ${VIEW_REGIONS.join(", ")}` };
  // A view in the earlier form is refused by name, so its writer learns the form in force.
  for (const old of ["blocks", "limits", "reports"] as const) {
    if (input[old] !== undefined) return { ok: false, refusal: "unknown_field", detail: `${old}: a view is {region, entries: [{pointer, form, ...}]}` };
  }
  const named = input.entries;
  if (!Array.isArray(named) || named.length === 0 || named.length > MAX_ENTRIES) return { ok: false, refusal: "bad_entry", detail: `entries: 1 to ${MAX_ENTRIES}` };
  const entries: ViewEntry[] = [];
  const keys = new Set<string>();
  for (const e of named) {
    const got = entryOf(e);
    if ("detail" in got) return { ok: false, refusal: "bad_entry", detail: got.detail };
    const key = JSON.stringify(Object.entries(got.entry.pointer).sort(([a], [b]) => a.localeCompare(b)));
    if (keys.has(key)) return { ok: false, refusal: "bad_entry", detail: `${got.entry.pointer.type} is named twice` };
    keys.add(key);
    entries.push(got.entry);
  }
  return { ok: true, entries };
}

function append(v: UiView): void {
  const f = file();
  mkdirSync(dirname(f), { recursive: true });
  appendFileSync(f, JSON.stringify(v) + "\n");
  passedOver.delete(v.region);
  const list = history.get(v.region) ?? [];
  list.push(v);
  history.set(v.region, list);
}

function defaultView(region: ViewRegion): UiView {
  return { region, revision: 0, id: `${region}@0`, entries: DEFAULT_VIEWS[region].entries, note: null, writtenBy: null, run: null, writtenAt: 0, undoOf: null };
}

/**
 * The view a region draws now: the newest valid revision, else its default (revision 0),
 * with the newest stored view that was passed over for being refused today.
 */
export function currentView(region: ViewRegion): ViewInForce {
  load();
  const latest = history.get(region)?.at(-1) ?? defaultView(region);
  return { ...latest, notDrawn: passedOver.get(region) ?? null, readers: VERDICT_READERS };
}

/** The next revision number: past every stored line, drawn or not. */
function nextRevision(region: ViewRegion): number {
  const drawn = history.get(region)?.at(-1)?.revision ?? 0;
  const skipped = passedOver.get(region);
  const skippedRevision = skipped ? Number(skipped.id.split("@")[1]) : 0;
  return Math.max(drawn, skippedRevision) + 1;
}

/** A value as JSON with every object's keys in order, so two spellings of one entry compare equal. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (typeof v === "object" && v !== null) {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

/** Same entries in the same order. The note is not drawn, so it does not make a view different. */
function sameView(v: UiView, entries: readonly ViewEntry[]): boolean {
  return canonical(v.entries) === canonical(entries);
}

/** Write a view for a region; refused writes store nothing. */
export function writeView(
  input: { region: unknown; entries: unknown; blocks?: unknown; limits?: unknown; reports?: unknown; note?: unknown },
  writtenBy: string | null,
  now: number = Date.now(),
  run: ViewRun | null = null,
): ViewWrite {
  load();
  const checked = validate(input);
  if (!checked.ok) return { ok: false, refusal: checked.refusal, detail: checked.detail };
  const region = input.region as ViewRegion;
  // A view identical to the one in force changes nothing on screen, so it is not a revision:
  // one run's retried step wrote the same view three times in a row (revisions 4 to 6 on one
  // node), and each read as a change to anything reading the log. The write still succeeds,
  // since what it asked for is in force, so a walk reads it as done, not as a failure.
  const current = currentView(region);
  if (current.notDrawn === null && sameView(current, checked.entries)) {
    return { ok: true, view: current, unchanged: true };
  }
  const revision = nextRevision(region);
  const view: UiView = {
    region,
    revision,
    id: `${region}@${revision}`,
    entries: checked.entries,
    note: typeof input.note === "string" && input.note.trim() ? input.note.trim().slice(0, 500) : null,
    writtenBy,
    run,
    writtenAt: now,
    undoOf: null,
  };
  append(view);
  return { ok: true, view };
}

/**
 * Restore the view in force before the current one, as a new revision. Undoing the
 * first view restores the default.
 */
export function undoView(region: unknown, writtenBy: string | null, now: number = Date.now(), run: ViewRun | null = null): ViewWrite {
  load();
  if (!isRegion(region)) return { ok: false, refusal: "unknown_region", detail: `regions: ${VIEW_REGIONS.join(", ")}` };
  const list = history.get(region) ?? [];
  const current = list.at(-1);
  if (!current) return { ok: false, refusal: "nothing_to_undo", detail: `${region} draws its default` };
  // The view in force before the current one: the previous revision, or the default.
  // Undoing an undo therefore restores what that undo replaced.
  const before = list.at(-2) ?? null;
  const restoredRevision = before?.revision ?? 0;
  const base = before ?? defaultView(region);
  const revision = nextRevision(region);
  const view: UiView = {
    region,
    revision,
    id: `${region}@${revision}`,
    entries: [...base.entries],
    note: base.note,
    writtenBy,
    run,
    writtenAt: now,
    undoOf: restoredRevision,
  };
  append(view);
  return { ok: true, view };
}

/** For tests: forget what was read, so the next call reads the file again. */
export function resetViewsForTest(): void {
  history.clear();
  passedOver.clear();
  loadedFrom = null;
}
