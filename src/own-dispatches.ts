/**
 * The runs this surface dispatched, kept here because only this vessel knows them.
 *
 * goal-host lists runs newest first, 50 a page, with no filter by operator. On
 * 10-14 the system ran 177 runs in three hours on node1, so a person's asks
 * sat at position 188 and the board's first page held none of them: "Mine"
 * showed "None" while all 247 of the person's runs were still in goal-host.
 * Every ask passes through this vessel's /api/run-goal, so the fact of what
 * this surface asked lives here (data locality), not behind a 2,000-row scan.
 *
 * Durable as an append-only file under WORKSPACE_ROOT, private to this vessel:
 * the shared interactor-log corpus has named external readers and this record
 * has one reader, the surface's own "Mine" list.
 */
import { appendFileSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface OwnDispatch {
  readonly dispatchId: string;
  readonly goal: string | null;
  readonly operator: string;
  /** Epoch ms when this surface dispatched it (or goal-host's startedAt on backfill). */
  readonly startedAt: number;
}

export interface KnownState {
  readonly status: "running" | "completed" | "failed";
  readonly reached: boolean | null;
  readonly executionId: string | null;
  /** When goal-host was last read for this run. */
  readonly checkedAt: number;
}

/** How often a finished run's state is re-read: a verdict can still land on it. */
export const FINISHED_RECHECK_MS = 5 * 60_000;
/** Reads goal-host makes per /api/mine call, at most. */
export const MAX_READS_PER_CALL = 8;

const file = (): string => join(process.env.WORKSPACE_ROOT ?? "/workspace", "human-surface", "own-dispatches.jsonl");

let loaded: OwnDispatch[] | null = null;
const states = new Map<string, KnownState>();

function load(): OwnDispatch[] {
  if (loaded) return loaded;
  loaded = [];
  const f = file();
  if (!existsSync(f)) return loaded;
  const seen = new Set<string>();
  for (const line of readFileSync(f, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line) as OwnDispatch;
      if (typeof r.dispatchId === "string" && !seen.has(r.dispatchId)) {
        seen.add(r.dispatchId);
        loaded.push(r);
      }
    } catch {
      /* a torn last line is skipped, never fatal */
    }
  }
  return loaded;
}

/** Record one dispatch. Idempotent by dispatchId. */
export function recordOwnDispatch(d: OwnDispatch): boolean {
  const all = load();
  if (!d.dispatchId || all.some((x) => x.dispatchId === d.dispatchId)) return false;
  const f = file();
  mkdirSync(join(f, ".."), { recursive: true });
  const fd = openSync(f, "a");
  try {
    appendFileSync(fd, JSON.stringify(d) + "\n");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  all.push(d);
  return true;
}

/** Newest first. */
export function listOwnDispatches(limit: number): readonly OwnDispatch[] {
  return [...load()].sort((a, b) => b.startedAt - a.startedAt).slice(0, Math.max(0, limit));
}

export function ownDispatchCount(): number {
  return load().length;
}

export function knownState(dispatchId: string): KnownState | undefined {
  return states.get(dispatchId);
}

export function rememberState(dispatchId: string, s: KnownState): void {
  states.set(dispatchId, s);
}

/** Which of these runs to re-read now: unknown first, then running, then stale finished ones. */
export function dueForRead(rows: readonly OwnDispatch[], now: number, max = MAX_READS_PER_CALL): string[] {
  const rank = (id: string): number | null => {
    const s = states.get(id);
    if (!s) return 0;
    if (s.status === "running") return 1;
    return now - s.checkedAt >= FINISHED_RECHECK_MS ? 2 : null;
  };
  return rows
    .map((r) => ({ id: r.dispatchId, rank: rank(r.dispatchId) }))
    .filter((x): x is { id: string; rank: number } => x.rank !== null)
    .sort((a, b) => a.rank - b.rank)
    .slice(0, max)
    .map((x) => x.id);
}

/** For tests: forget everything held in memory (the file is the test's own temp root). */
export function resetOwnDispatchesForTest(): void {
  loaded = null;
  states.clear();
}
