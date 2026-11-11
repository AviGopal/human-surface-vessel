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

/** The regions a view can be written for. */
export const VIEW_REGIONS = ["landing"] as const;

export type ViewRegion = (typeof VIEW_REGIONS)[number];

/**
 * What an entry reads: a pointer resolved through discovery, with the shape in `type` and
 * any arguments as plain values. Whatever serves the shape answers; the surface draws the
 * answer and does not interpret it.
 */
export type ReportPointer = Readonly<Record<string, string | number | boolean>> & { readonly type: string };

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
 * citing it under the person's own key.
 */
export type ViewEntry = {
  readonly pointer: ReportPointer;
  readonly form: EntryForm;
  readonly title?: string;
  readonly field?: string;
  readonly show?: number;
  readonly judge?: "outcome";
};

/** How many entries one view may name, and how many rows `show` may ask for. */
const MAX_ENTRIES = 8;
const MAX_SHOW = 200;
const SHAPE_NAME = /^[A-Za-z][A-Za-z0-9_:.-]{0,79}$/;
const FIELD_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

/**
 * What a region draws with no view written, in the order the person needs it: what waits on
 * them, then what changed. How the system is doing has no answer a bare pointer can read yet
 * (the walk's posterior needs a list of cells, which a view argument cannot carry), so it is
 * not named until something serves it. Every pointer only reads, so
 * drawing the screen never acts on the system; a view the system writes replaces the list.
 */
export const DEFAULT_VIEWS: Record<ViewRegion, { entries: readonly ViewEntry[] }> = {
  landing: {
    entries: [
      { pointer: { type: "uiQuestion", open: true }, form: "questions", field: "questions", title: "Waiting on you" },
      { pointer: { type: "record_read", shape: "world_changed" }, form: "rows", show: 10, title: "What people asked" },
      { pointer: { type: "record_read", shape: "answer" }, form: "rows", show: 10, judge: "outcome", title: "What the walk answered" },
      { pointer: { type: "record_read", shape: "failure" }, form: "rows", show: 10, title: "What failed" },
      { pointer: { type: "record_read", shape: "outcome" }, form: "rows", show: 10, title: "Verdicts and outcomes" },
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
    `entries is a list of 1 to ${MAX_ENTRIES} {pointer: {type, ...plain arguments}, form: ${ENTRY_FORMS.join(" | ")}, title?, field?, show?: 1..${MAX_SHOW}, judge?: "outcome"}, ` +
    `drawn top to bottom in list order; a pointer is never a _write shape. form fields draws an answer's plain values; rows draws each row in full; ` +
    `questions draws each row as a question the surface holds. field names the answer's field holding the rows; show draws the last n rows as the producer ordered them; ` +
    `judge "outcome" (rows only) offers a person's verdict on each row`;
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
export type ViewInForce = UiView & { readonly notDrawn: NotDrawn | null };

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
function entryOf(e: unknown): { entry: ViewEntry } | { detail: string } {
  if (typeof e !== "object" || e === null || Array.isArray(e)) return { detail: "each entry is {pointer, form}" };
  const { pointer, form, title, field, show, judge, ...rest } = e as Record<string, unknown>;
  if (Object.keys(rest).length > 0) return { detail: `${Object.keys(rest).join(", ")}: an entry has pointer, form, title, field, show and judge only` };
  const got = pointerOf(pointer);
  if ("detail" in got) return got;
  if (typeof form !== "string" || !(ENTRY_FORMS as readonly string[]).includes(form)) return { detail: `form: ${ENTRY_FORMS.join(", ")}` };
  if (title !== undefined && (typeof title !== "string" || !title.trim() || title.length > 80)) return { detail: "title: 1 to 80 characters" };
  if (field !== undefined && (typeof field !== "string" || !FIELD_NAME.test(field))) return { detail: "field: a field name" };
  if (show !== undefined && (typeof show !== "number" || !Number.isInteger(show) || show < 1 || show > MAX_SHOW)) return { detail: `show: 1..${MAX_SHOW}` };
  if (judge !== undefined && judge !== "outcome") return { detail: `judge: "outcome"` };
  if (judge !== undefined && form !== "rows") return { detail: `judge needs form "rows": a verdict is on a row` };
  return {
    entry: {
      pointer: got.pointer,
      form: form as EntryForm,
      ...(typeof title === "string" ? { title: title.trim() } : {}),
      ...(typeof field === "string" ? { field } : {}),
      ...(typeof show === "number" ? { show } : {}),
      ...(judge === "outcome" ? { judge } : {}),
    },
  };
}

function pointerOf(r: unknown): { pointer: ReportPointer } | { detail: string } {
  if (typeof r !== "object" || r === null || Array.isArray(r)) return { detail: "pointer is an object with a type" };
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(r as Record<string, unknown>)) {
    if (typeof v !== "string" && typeof v !== "number" && typeof v !== "boolean") return { detail: `${k}: arguments are plain values` };
    out[k] = v;
  }
  const type = out["type"];
  if (typeof type !== "string" || !SHAPE_NAME.test(type)) return { detail: `type: a shape name` };
  // Drawing the screen must not write anything, and a _write shape is a write by name.
  if (type.endsWith("_write")) return { detail: `${type}: a view only reads` };
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
  return { ...latest, notDrawn: passedOver.get(region) ?? null };
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
