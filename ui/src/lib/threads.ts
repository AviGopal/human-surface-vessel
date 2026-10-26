/**
 * Threads: runs of the same ask, grouped. A person who asks the same thing seven
 * times sees one line with its history, not seven lines with the same text.
 *
 * Display only. The grouping key is the goal text with case, spacing and
 * closing punctuation ignored; it does not claim two asks mean the same thing.
 * The system's own runs can instead be grouped by the template the system
 * routed them to: a fact the run reports, never read from its wording.
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
  /** When grouped by the template the system routed these runs to: that template. */
  readonly template?: string;
}

export function threadKey(goal: string | null | undefined): string {
  return (goal ?? "").trim().toLowerCase().replace(/\s+/g, " ").replace(/[\s.?!…]+$/u, "");
}

/**
 * Groups runs by ask, or by the template a run was routed to when `templateOf`
 * names one; a run not routed yet stays with its ask. A thread sits where its
 * newest run sits. Input order is kept within a thread.
 */
export function groupThreads<T extends ThreadRun>(runs: readonly T[], templateOf?: (run: T) => string | null | undefined): readonly Thread<T>[] {
  const byKey = new Map<string, { template?: string; list: T[] }>();
  for (const run of runs) {
    const template = templateOf?.(run) || undefined;
    const key = template !== undefined ? `template\u0000${template}` : threadKey(run.goal);
    const entry = byKey.get(key);
    if (entry) entry.list.push(run);
    else byKey.set(key, { ...(template !== undefined ? { template } : {}), list: [run] });
  }
  const threads = [...byKey].map(([key, { template, list }]) => ({
    key,
    runs: [...list].sort((a, b) => b.startedAtMs - a.startedAtMs || (a.dispatchId < b.dispatchId ? -1 : 1)),
    ...(template !== undefined ? { template } : {}),
  }));
  return threads.sort((a, b) => {
    const x = a.runs[0]!;
    const y = b.runs[0]!;
    return y.startedAtMs - x.startedAtMs || (x.dispatchId < y.dispatchId ? -1 : 1);
  });
}

/** "gone": the run's record is gone and no outcome was kept; counted apart, never as unjudged. */
export type Mark = "reached" | "missed" | "open" | "gone";

/** What people said about a run, against the judge: agree, disagree, or nothing said. */
export type PersonSaid = "agree" | "disagree" | null;

/** How far this ask has got: each run's outcome oldest first, and whether the latest finished run reached. */
export interface LearningMark {
  readonly marks: readonly Mark[];
  /** Per mark, oldest first: whether a person's latest verdict agreed with the judge. */
  readonly said: readonly PersonSaid[];
  /** Runs whose judged outcome a person disputed. */
  readonly disputed: number;
  readonly reached: number;
  readonly judged: number;
  /** Runs whose record is gone with no outcome kept. */
  readonly gone: number;
  /** Reached now after missing before; missed now after reaching before; or neither. */
  readonly trend: "learned" | "lost" | null;
}

/** The most recent marks drawn; older runs still count in the totals. */
export const MARKS_SHOWN = 8;

/** Each run's latest person verdict, as reached or not; "partial" says neither. */
export function personReachedByRun(verdicts: readonly { dispatch_id: string | null; verdict: string; observedAt: number }[]): Map<string, boolean> {
  const latest = new Map<string, { at: number; v: string }>();
  for (const v of verdicts) {
    if (!v.dispatch_id) continue;
    const prev = latest.get(v.dispatch_id);
    if (!prev || v.observedAt > prev.at) latest.set(v.dispatch_id, { at: v.observedAt, v: v.verdict });
  }
  const out = new Map<string, boolean>();
  for (const [id, { v }] of latest) if (v === "achieved" || v === "not_achieved") out.set(id, v === "achieved");
  return out;
}

export function learningMark(runs: readonly ThreadRun[], personReached: ReadonlyMap<string, boolean> = new Map()): LearningMark {
  const oldestFirst = [...runs].sort((a, b) => a.startedAtMs - b.startedAtMs);
  const said: PersonSaid[] = oldestFirst.map((r) => {
    const p = personReached.get(r.dispatchId);
    if (p === undefined || r.reached === null) return null;
    return p === r.reached ? "agree" : "disagree";
  });
  const marks: Mark[] = oldestFirst.map((r) => (r.status === "gone" ? "gone" : r.status === "running" || r.reached === null ? "open" : r.reached ? "reached" : "missed"));
  const judged = marks.filter((m) => m === "reached" || m === "missed");
  const gone = marks.filter((m) => m === "gone").length;
  const reached = judged.filter((m) => m === "reached").length;
  const last = judged[judged.length - 1];
  const before = judged.slice(0, -1);
  const trend = last === "reached" && before.includes("missed") ? "learned" : last === "missed" && before.includes("reached") ? "lost" : null;
  return { marks: marks.slice(-MARKS_SHOWN), said: said.slice(-MARKS_SHOWN), disputed: said.filter((x) => x === "disagree").length, reached, judged: judged.length, gone, trend };
}
