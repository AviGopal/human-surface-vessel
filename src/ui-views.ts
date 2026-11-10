/**
 * Views for the surface's regions: which blocks a region draws, in what order, and
 * how many items a block lists. A view is written through `uiView_write` by anything
 * that can author an impulse, a learned activity included, and the region draws the
 * newest valid one at use time. With none written, a region draws its default.
 *
 * The vocabulary is closed: a region names only blocks the surface can draw, and a
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

/**
 * Each region and the blocks it can draw. The landing's run blocks (the newest run, the
 * person's runs, a reached count over runs) are gone with goal-host, the only producer of
 * what they drew; a stored view naming one is no longer replayed.
 */
export const VIEW_REGIONS = {
  landing: ["needs_you", "reports"],
} as const;

export type ViewRegion = keyof typeof VIEW_REGIONS;
export type LandingBlock = (typeof VIEW_REGIONS)["landing"][number];

/** The limits a region accepts, and their range. */
const VIEW_LIMITS: Record<ViewRegion, Record<string, { min: number; max: number }>> = {
  landing: { needs_you: { min: 1, max: 20 } },
};

/**
 * A report the `reports` block reads: a pointer resolved through discovery, with the
 * shape in `type` and any arguments as plain values. Whatever serves the shape answers;
 * the surface draws the answer and does not interpret it.
 */
export type ReportPointer = Readonly<Record<string, string | number | boolean>> & { readonly type: string };

/**
 * How an answer is drawn, kept beside the pointer and never sent with it. `rows`: a list of
 * rows, each with every field in full. `judge: "outcome"`: each row offers a verdict, written
 * as an outcome row citing it, under the signed-in person's own key.
 */
export type ReportForm = { readonly pointer: ReportPointer; readonly form?: "rows"; readonly judge?: "outcome" };

/** What a view names in `reports`: a bare pointer (drawn as fields), or a pointer with its form. */
export type ReportItem = ReportPointer | ReportForm;

/** The pointer an item reads: the producer is sent this and nothing else. */
export function pointerOfItem(item: ReportItem): ReportPointer {
  return isReportForm(item) ? item.pointer : item;
}

export function isReportForm(item: ReportItem): item is ReportForm {
  return typeof (item as { pointer?: unknown }).pointer === "object" && (item as { pointer?: unknown }).pointer !== null;
}

/** How many reports one view may name. */
const MAX_REPORTS = 8;
const SHAPE_NAME = /^[A-Za-z][A-Za-z0-9_:.-]{0,79}$/;

/**
 * What a region draws with no view written. The landing's default reads reports that
 * only read (they file and change nothing), so drawing the screen never acts on the
 * system; a view written by the system replaces this list.
 */
export const DEFAULT_VIEWS: Record<ViewRegion, { blocks: readonly string[]; limits: Record<string, number>; reports: readonly ReportItem[] }> = {
  landing: {
    blocks: ["needs_you", "reports"],
    limits: {},
    reports: [
      // What the walk answered, each answer in full, with a person's verdict offered on it.
      { pointer: { type: "record_read", shape: "answer" }, form: "rows", judge: "outcome" },
      { type: "trace_failure_pattern_report" },
      { type: "failure_count_report" },
      { type: "execution_trace", limit: 10 },
      { type: "system_load_report" },
    ],
  },
};

/** The contract a region's views are checked against: blocks, limits and default per region. */
export interface ViewContract {
  readonly regions: Readonly<Record<string, readonly string[]>>;
  readonly limits: Readonly<Record<string, Readonly<Record<string, { min: number; max: number }>>>>;
  readonly defaults: Readonly<Record<string, { blocks: readonly string[]; reports?: readonly ReportItem[] }>>;
}

const CONTRACT: ViewContract = { regions: VIEW_REGIONS, limits: VIEW_LIMITS, defaults: DEFAULT_VIEWS };

/**
 * What discovery is told about the view shapes, generated from the contract above, so a
 * goal is matched against the vocabulary a write is actually checked against and the
 * description cannot drift from it: a region or block added here is advertised with it.
 */
export function viewShapeDescriptions(contract: ViewContract = CONTRACT): Record<"uiView_write" | "human_surface:ui_view", string> {
  const regions = Object.entries(contract.regions).map(([region, blocks]) => {
    const limits = Object.entries(contract.limits[region] ?? {}).map(([k, r]) => `${k} lists ${r.min} to ${r.max} items`);
    const fallback = contract.defaults[region]?.blocks ?? [];
    const reports = contract.defaults[region]?.reports ?? [];
    return `region ${region}: blocks ${blocks.join(", ")}${limits.length ? `; ${limits.join(", ")}` : ""}; default ${fallback.join(", ") || "none"}` +
      (blocks.includes("reports") ? `; the reports block draws the answer to each pointer in reports (1 to ${MAX_REPORTS}, each {type, ...plain arguments}, never a _write shape; or {pointer, form: "rows", judge?: "outcome"} to draw each row in full and offer a person's verdict on it)${reports.length ? `, by default ${reports.map((r) => pointerOfItem(r).type).join(", ")}` : ""}` : "");
  });
  const names = Object.keys(contract.regions).join(", ");
  return {
    uiView_write:
      `writes the view of a human surface region (${names}): which blocks the region draws and in what order, ` +
      `top to bottom as the blocks list orders them; a block left out is not drawn. ${regions.join(". ")}. ` +
      `a write naming the view already in force succeeds as unchanged and writes no revision; ` +
      `undo restores the view in force before the current one; read back in human_surface:ui_view`,
    "human_surface:ui_view":
      `reads what the human surface draws now: for each region (${names}) the view in force, its blocks in draw order, ` +
      `item limits, revision and writer. ${regions.join(". ")}. Views are written by uiView_write`,
  };
}

/** Why a write stored nothing. Closed, so the writer can act on it without parsing prose. */
export type ViewRefusal =
  | "unknown_region"
  | "unknown_block"
  | "duplicate_block"
  | "empty_blocks"
  | "unknown_limit"
  | "limit_out_of_range"
  | "bad_report"
  | "nothing_to_undo";

export interface UiView {
  readonly region: ViewRegion;
  /** 1 for the first view written for the region; the default is revision 0. */
  readonly revision: number;
  /** `<region>@<revision>`: what a report names when it says which view it drew. */
  readonly id: string;
  readonly blocks: readonly string[];
  readonly limits: Readonly<Record<string, number>>;
  /** What the reports block reads, in draw order; empty when the view draws no reports. */
  readonly reports: readonly ReportItem[];
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
let loadedFrom: string | null = null;

function isRegion(v: unknown): v is ViewRegion {
  return typeof v === "string" && Object.hasOwn(VIEW_REGIONS, v);
}

function load(): void {
  const f = file();
  if (loadedFrom === f) return;
  loadedFrom = f;
  history.clear();
  if (!existsSync(f)) return;
  for (const line of readFileSync(f, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let v: UiView;
    try {
      v = JSON.parse(line) as UiView;
    } catch {
      continue;
    }
    // A line that would be refused today is not replayed: the file never widens the vocabulary.
    if (!isRegion(v?.region) || !Number.isInteger(v.revision) || v.revision < 1) continue;
    // A line written before views named reports carries none.
    v = { ...v, reports: v.reports ?? [] };
    if (validate(v.region, v.blocks, v.limits, v.reports).refusal) continue;
    const list = history.get(v.region) ?? [];
    list.push(v);
    history.set(v.region, list);
  }
}

/** A report pointer as written, or why it is not one. */
function reportOf(r: unknown): { pointer: ReportPointer; item: ReportItem } | { detail: string } {
  if (typeof r === "object" && r !== null && !Array.isArray(r) && Object.hasOwn(r, "pointer")) {
    const { pointer, form, judge, ...rest } = r as Record<string, unknown>;
    if (Object.keys(rest).length > 0) return { detail: `${Object.keys(rest).join(", ")}: an entry has pointer, form and judge only` };
    const got = pointerOf(pointer);
    if ("detail" in got) return got;
    if (form !== undefined && form !== "rows") return { detail: `form: "rows"` };
    if (judge !== undefined && judge !== "outcome") return { detail: `judge: "outcome"` };
    if (judge !== undefined && form !== "rows") return { detail: `judge needs form "rows": a verdict is on a row` };
    const item: ReportForm = { pointer: got.pointer, ...(form ? { form } : {}), ...(judge ? { judge } : {}) };
    return { pointer: got.pointer, item };
  }
  const got = pointerOf(r);
  return "detail" in got ? got : { pointer: got.pointer, item: got.pointer };
}

function pointerOf(r: unknown): { pointer: ReportPointer } | { detail: string } {
  if (typeof r !== "object" || r === null || Array.isArray(r)) return { detail: "each report is a pointer object with a type" };
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(r as Record<string, unknown>)) {
    if (typeof v !== "string" && typeof v !== "number" && typeof v !== "boolean") return { detail: `${k}: arguments are plain values` };
    out[k] = v;
  }
  const type = out["type"];
  if (typeof type !== "string" || !SHAPE_NAME.test(type)) return { detail: `type: a shape name` };
  // Drawing the screen must not write anything, and a _write shape is a write by name.
  if (type.endsWith("_write")) return { detail: `${type}: a write is not a report` };
  return { pointer: out as ReportPointer };
}

function validate(region: unknown, blocks: unknown, limits: unknown, reports: unknown = []): { refusal: ViewRefusal | null; detail: string } {
  if (!isRegion(region)) return { refusal: "unknown_region", detail: `regions: ${Object.keys(VIEW_REGIONS).join(", ")}` };
  const allowed: readonly string[] = VIEW_REGIONS[region];
  if (!Array.isArray(blocks) || blocks.length === 0) return { refusal: "empty_blocks", detail: `blocks: ${allowed.join(", ")}` };
  const seen = new Set<string>();
  for (const b of blocks) {
    if (typeof b !== "string" || !allowed.includes(b)) return { refusal: "unknown_block", detail: `${String(b)}; blocks: ${allowed.join(", ")}` };
    if (seen.has(b)) return { refusal: "duplicate_block", detail: b };
    seen.add(b);
  }
  if (limits !== undefined && limits !== null) {
    if (typeof limits !== "object" || Array.isArray(limits)) return { refusal: "unknown_limit", detail: "limits is an object" };
    const ranges = VIEW_LIMITS[region];
    for (const [k, n] of Object.entries(limits as Record<string, unknown>)) {
      const range = ranges[k];
      if (!range) return { refusal: "unknown_limit", detail: `${k}; limits: ${Object.keys(ranges).join(", ") || "none"}` };
      if (typeof n !== "number" || !Number.isInteger(n) || n < range.min || n > range.max) {
        return { refusal: "limit_out_of_range", detail: `${k}: ${range.min}..${range.max}` };
      }
    }
  }
  const named = reports ?? [];
  if (!Array.isArray(named)) return { refusal: "bad_report", detail: "reports is a list of pointers" };
  if (named.length > MAX_REPORTS) return { refusal: "bad_report", detail: `at most ${MAX_REPORTS} reports` };
  if (seen.has("reports") && named.length === 0) return { refusal: "bad_report", detail: "the reports block names at least one report" };
  if (!seen.has("reports") && named.length > 0) return { refusal: "bad_report", detail: "reports are drawn only by the reports block" };
  const keys = new Set<string>();
  for (const r of named) {
    const got = reportOf(r);
    if ("detail" in got) return { refusal: "bad_report", detail: got.detail };
    const key = JSON.stringify(Object.entries(got.pointer).sort(([a], [b]) => a.localeCompare(b)));
    if (keys.has(key)) return { refusal: "bad_report", detail: `${got.pointer.type} is named twice` };
    keys.add(key);
  }
  return { refusal: null, detail: "" };
}

function append(v: UiView): void {
  const f = file();
  mkdirSync(dirname(f), { recursive: true });
  appendFileSync(f, JSON.stringify(v) + "\n");
  const list = history.get(v.region) ?? [];
  list.push(v);
  history.set(v.region, list);
}

/** The view a region draws now: the newest valid revision, else its default (revision 0). */
export function currentView(region: ViewRegion): UiView {
  load();
  const latest = history.get(region)?.at(-1);
  if (latest) return latest;
  const d = DEFAULT_VIEWS[region];
  return { region, revision: 0, id: `${region}@0`, blocks: d.blocks, limits: d.limits, reports: d.reports, note: null, writtenBy: null, run: null, writtenAt: 0, undoOf: null };
}

/** Same blocks in the same order, the same limits and the same reports. The note is not drawn, so it does not make a view different. */
function sameView(v: UiView, blocks: readonly string[], limits: Readonly<Record<string, number>>, reports: readonly ReportItem[]): boolean {
  if (v.blocks.length !== blocks.length || v.blocks.some((b, i) => b !== blocks[i])) return false;
  if (JSON.stringify(v.reports) !== JSON.stringify(reports)) return false;
  const a = Object.entries(v.limits).sort(([x], [y]) => x.localeCompare(y));
  const b = Object.entries(limits).sort(([x], [y]) => x.localeCompare(y));
  return a.length === b.length && a.every(([k, n], i) => b[i]![0] === k && b[i]![1] === n);
}

/** Write a view for a region; refused writes store nothing. */
export function writeView(
  input: { region: unknown; blocks: unknown; limits?: unknown; reports?: unknown; note?: unknown },
  writtenBy: string | null,
  now: number = Date.now(),
  run: ViewRun | null = null,
): ViewWrite {
  load();
  const { refusal, detail } = validate(input.region, input.blocks, input.limits, input.reports ?? []);
  if (refusal) return { ok: false, refusal, detail };
  const region = input.region as ViewRegion;
  const reports = ((input.reports as unknown[] | undefined) ?? []).map((r) => (reportOf(r) as { item: ReportItem }).item);
  // A view identical to the one in force changes nothing on screen, so it is not a revision:
  // one run's retried step wrote the same view three times in a row (revisions 4 to 6 on one
  // node), and each read as a change to anything reading the log. The write still succeeds,
  // since what it asked for is in force, so a walk reads it as done, not as a failure.
  const current = currentView(region);
  if (sameView(current, input.blocks as string[], (input.limits as Record<string, number> | undefined) ?? {}, reports)) {
    return { ok: true, view: current, unchanged: true };
  }
  const revision = currentView(region).revision + 1;
  const view: UiView = {
    region,
    revision,
    id: `${region}@${revision}`,
    blocks: [...(input.blocks as string[])],
    limits: { ...((input.limits as Record<string, number> | undefined) ?? {}) },
    reports,
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
  if (!isRegion(region)) return { ok: false, refusal: "unknown_region", detail: `regions: ${Object.keys(VIEW_REGIONS).join(", ")}` };
  const list = history.get(region) ?? [];
  const current = list.at(-1);
  if (!current) return { ok: false, refusal: "nothing_to_undo", detail: `${region} draws its default` };
  // The view in force before the current one: the previous revision, or the default.
  // Undoing an undo therefore restores what that undo replaced.
  const before = list.at(-2) ?? null;
  const restoredRevision = before?.revision ?? 0;
  const base = before ?? { blocks: DEFAULT_VIEWS[region].blocks, limits: DEFAULT_VIEWS[region].limits, reports: DEFAULT_VIEWS[region].reports, note: null };
  const revision = current.revision + 1;
  const view: UiView = {
    region,
    revision,
    id: `${region}@${revision}`,
    blocks: [...base.blocks],
    limits: { ...base.limits },
    reports: [...base.reports],
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
  loadedFrom = null;
}
