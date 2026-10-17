/**
 * Threads: runs of the same ask, grouped. A person who asks the same thing seven
 * times sees one line with its history, not seven lines with the same text.
 *
 * Display only. The grouping key is the goal text with case, spacing and
 * closing punctuation ignored; it does not claim two asks mean the same thing.
 */

export interface ThreadRun {
  readonly dispatchId: string;
  readonly startedAtMs: number;
  readonly goal?: string | null;
  readonly reached: boolean | null;
  readonly status: string;
}

export interface Thread<T extends ThreadRun> {
  readonly key: string;
  /** Newest first. */
  readonly runs: readonly T[];
}

export function threadKey(goal: string | null | undefined): string {
  return (goal ?? "").trim().toLowerCase().replace(/\s+/g, " ").replace(/[\s.?!…]+$/u, "");
}

/** Groups runs by ask; a thread sits where its newest run sits. Input order is kept within a thread. */
export function groupThreads<T extends ThreadRun>(runs: readonly T[]): readonly Thread<T>[] {
  const byKey = new Map<string, T[]>();
  for (const run of runs) {
    const key = threadKey(run.goal);
    const list = byKey.get(key);
    if (list) list.push(run);
    else byKey.set(key, [run]);
  }
  const threads = [...byKey].map(([key, list]) => ({
    key,
    runs: [...list].sort((a, b) => b.startedAtMs - a.startedAtMs || (a.dispatchId < b.dispatchId ? -1 : 1)),
  }));
  return threads.sort((a, b) => {
    const x = a.runs[0]!;
    const y = b.runs[0]!;
    return y.startedAtMs - x.startedAtMs || (x.dispatchId < y.dispatchId ? -1 : 1);
  });
}

export type Mark = "reached" | "missed" | "open";

/** How far this ask has got: each run's outcome oldest first, and whether the latest finished run reached. */
export interface LearningMark {
  readonly marks: readonly Mark[];
  readonly reached: number;
  readonly judged: number;
  /** Reached now after missing before; missed now after reaching before; or neither. */
  readonly trend: "learned" | "lost" | null;
}

/** The most recent marks drawn; older runs still count in the totals. */
export const MARKS_SHOWN = 8;

export function learningMark(runs: readonly ThreadRun[]): LearningMark {
  const oldestFirst = [...runs].sort((a, b) => a.startedAtMs - b.startedAtMs);
  const marks: Mark[] = oldestFirst.map((r) => (r.status === "running" || r.reached === null ? "open" : r.reached ? "reached" : "missed"));
  const judged = marks.filter((m) => m !== "open");
  const reached = judged.filter((m) => m === "reached").length;
  const last = judged[judged.length - 1];
  const before = judged.slice(0, -1);
  const trend = last === "reached" && before.includes("missed") ? "learned" : last === "missed" && before.includes("reached") ? "lost" : null;
  return { marks: marks.slice(-MARKS_SHOWN), reached, judged: judged.length, trend };
}
