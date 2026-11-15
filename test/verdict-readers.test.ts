/**
 * A verdict the default view offers reaches its reader. Two halves, so the table cannot vouch for
 * itself: each judged entry's read (threads included) carries, in its `where`, every field its
 * reader needs (VERDICT_READERS); and each reader's own code filters on that field and value.
 *
 * The readers live in other vessels and in pull-sync, so their code is read where it is installed
 * beside this vessel. Where a reader is not installed (an image older than it), its half is skipped
 * and says so by name: a pin with nothing to read is not a pass.
 *
 * Shape: qa 11-15 ruling (A): the USER's Rights on gaps no one held had no reader; research 11-15:
 * the needs must be checked against what each reader filters on, not against the table.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { currentView, DEFAULT_VIEWS, VERDICT_READERS, type ViewEntry } from "../src/ui-views.ts";

/** Every judged entry of the default views, threads included. */
function judged(): { entry: ViewEntry; at: string }[] {
  const out: { entry: ViewEntry; at: string }[] = [];
  const walk = (e: ViewEntry, at: string) => {
    if (e.judge) out.push({ entry: e, at });
    const t = e.thread;
    for (const [i, c] of (Array.isArray(t) ? t : t ? [t] : []).entries()) walk(c as ViewEntry, `${at} › thread ${i}`);
  };
  for (const [region, v] of Object.entries(DEFAULT_VIEWS)) for (const [i, e] of v.entries.entries()) walk(e, `${region} ${i} (${e.title ?? e.pointer["shape"]})`);
  return out;
}

/** What the entry's read misses of its reader's needs; "no reader" when none reads it. */
function unmet(entry: ViewEntry): string[] {
  const shape = String(entry.pointer["shape"]);
  const reader = VERDICT_READERS.find((r) => r.judge === entry.judge && r.shape === shape);
  if (!reader) return [`no reader of a ${entry.judge} verdict on ${shape}`];
  const where = (entry.pointer["where"] ?? {}) as Record<string, unknown>;
  return Object.entries(reader.needs).filter(([k, v]) => where[k] !== v).map(([k, v]) => `${shape} needs where ${k}: ${JSON.stringify(v)}`);
}

test("must-fail: the readers are served with the view, so the page reads them at use time", () => {
  expect(currentView("landing").readers).toEqual(VERDICT_READERS);
});

describe("each verdict offered reaches its reader", () => {
  const all = judged();

  test("must-fail: every judged entry but the failing checks reads only rows its reader reads", () => {
    const rest = all.filter(({ entry }) => entry.pointer["shape"] !== "gap");
    expect(rest.length).toBeGreaterThanOrEqual(3);
    expect(rest.flatMap(({ entry, at }) => unmet(entry).map((m) => `${at}: ${m}`))).toEqual([]);
  });

  // INVERTED: this passes by failing. Pull-sync reads a person's verdict only on a gap held for one (the hold is in
  // the row's meta, which no read can match), so the failing checks are read wide and the title says what a verdict
  // does on a held one. When the gap rows carry waits_for (the coordinator's gap) and the default reads by it, this
  // passes, bun reports it as a failure, and `.failing` must come off.
  test.failing("the failing checks read only gaps held for a person", () => {
    const gaps = all.filter(({ entry }) => entry.pointer["shape"] === "gap");
    expect(gaps.length).toBe(1);
    expect(gaps.flatMap(({ entry }) => unmet(entry))).toEqual([]);
  });
});

/**
 * Where each reader's code is installed beside this vessel, and the files a constant it compares with
 * may be named in. The match is a comparison of the field with the value, literally or through a constant.
 */
const READER_CODE: Record<string, { file: string; consts?: string }> = {
  answer: { file: "/vessels/records-vessel/src/fold.ts", consts: "/vessels/records-vessel/src/shapes.ts" },
  gap: { file: "/usr/local/bin/substrate-pull-sync" },
  gitDiff: { file: "/vessels/local-tools-vessel/src/git-land.ts" },
};
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function filtersOn(code: string, consts: string, k: string, v: unknown): boolean {
  const value = JSON.stringify(v);
  if (new RegExp(`\\.${esc(k)}\\s*===?\\s*${esc(value)}`).test(code)) return true;
  const named = [...consts.matchAll(new RegExp(`const\\s+([A-Z_][A-Z0-9_]*)\\s*=\\s*${esc(value)}`, "g"))].map((m) => m[1]!);
  return named.some((c) => new RegExp(`\\.${esc(k)}\\s*===?\\s*${c}\\b`).test(code));
}

describe("each reader filters on what the table says it needs", () => {
  for (const reader of VERDICT_READERS) {
    const at = READER_CODE[reader.shape];
    const installed = at !== undefined && existsSync(at.file);
    const name = `${reader.read_by} filters on ${JSON.stringify(reader.needs)}${installed ? "" : " (reader not installed here: skipped)"}`;
    const check = () => {
      const code = readFileSync(at!.file, "utf8");
      const consts = at!.consts && existsSync(at!.consts) ? readFileSync(at!.consts, "utf8") : code;
      expect(Object.entries(reader.needs).filter(([k, v]) => !filtersOn(code, consts, k, v))).toEqual([]);
    };
    // INVERTED for the gap, as above: pull-sync reads the hold from meta and has no waits_for yet.
    if (!installed) test.skip(name, check);
    else if (reader.shape === "gap") test.failing(name, check);
    else test(`must-fail: ${name}`, check);
  }

  test("every reader is known by where its code is", () => {
    expect(VERDICT_READERS.filter((r) => READER_CODE[r.shape] === undefined)).toEqual([]);
  });

  test("the match is a comparison of the field with the value, not the value anywhere", () => {
    expect(filtersOn('x.role === "walk"', "", "role", "walk")).toBe(true);
    expect(filtersOn("r.role === DESCRIBED", 'export const DESCRIBED = "described"', "role", "described")).toBe(true);
    expect(filtersOn('select(.waits_for == "person")', "", "waits_for", "person")).toBe(true);
    expect(filtersOn('x.role === "walker"; const k = "walk"', "", "role", "walk")).toBe(false);
    expect(filtersOn("r.role === DESCRIBED", 'const DESCRIBED = "described"', "role", "walk")).toBe(false);
  });
});
