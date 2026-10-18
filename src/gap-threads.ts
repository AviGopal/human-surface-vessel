/**
 * Gap threads: the system's own work on a gap, joined by the fields the attempt
 * ledger records, never by matching goal text.
 *
 *   gap (gap store) ← attemptIntent.gap_id → attempt_id → attemptOutcome (verdict,
 *   landed, commit) and attemptSettlement (dispatch_id, shas)
 *
 * An attempt's run is its intent's dispatch_id, or its settlement's; many attempts
 * record neither, and they are shown as attempts with no run recorded.
 */

type Rec = Record<string, unknown>;

export interface GapAttempt {
  readonly attemptId: string;
  readonly at: string | null;
  readonly route: string | null;
  readonly stage: string | null;
  readonly dispatchId: string | null;
  readonly outcome: string | null;
  readonly verdict: string | null;
  readonly landed: boolean;
  readonly commit: string | null;
}

export interface GapThread {
  readonly gapId: string;
  readonly summary: string | null;
  readonly status: string | null;
  readonly severity: string | null;
  readonly reopenCount: number;
  readonly detectedAt: string | null;
  readonly closedAt: string | null;
  /** Newest first, capped; `attemptCount` is the full number. */
  readonly attempts: readonly GapAttempt[];
  readonly attemptCount: number;
  readonly landedCount: number;
  readonly lastAt: string | null;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

export function joinGapThreads(
  gaps: readonly Rec[],
  intents: readonly Rec[],
  outcomes: readonly Rec[],
  settlements: readonly Rec[],
  opts: { threads?: number; attemptsPerThread?: number } = {},
): GapThread[] {
  const maxThreads = opts.threads ?? 40;
  const perThread = opts.attemptsPerThread ?? 10;
  const gapById = new Map(gaps.map((g) => [String(g["id"]), g]));
  const outcomeBy = new Map<string, Rec>();
  for (const o of outcomes) if (str(o["attempt_id"])) outcomeBy.set(String(o["attempt_id"]), o);
  const settleBy = new Map<string, Rec>();
  for (const s of settlements) if (str(s["attempt_id"])) settleBy.set(String(s["attempt_id"]), s);

  const byGap = new Map<string, GapAttempt[]>();
  for (const i of intents) {
    const gapId = str(i["gap_id"]);
    const attemptId = str(i["attempt_id"]);
    if (!gapId || !attemptId) continue;
    const o = outcomeBy.get(attemptId);
    const s = settleBy.get(attemptId);
    const attempt: GapAttempt = {
      attemptId,
      at: str(o?.["at"]) ?? str(i["registered_at"]),
      route: str(i["route"]),
      stage: str(o?.["stage"]) ?? str(i["stage"]),
      dispatchId: str(i["dispatch_id"]) ?? str(s?.["dispatch_id"]),
      outcome: str(o?.["outcome"]),
      verdict: str(o?.["verdict"]) ?? str(s?.["verdict"]),
      landed: o?.["landed"] === true,
      commit: str(o?.["commit"]),
    };
    const list = byGap.get(gapId);
    if (list) list.push(attempt);
    else byGap.set(gapId, [attempt]);
  }

  const threads: GapThread[] = [];
  for (const [gapId, attempts] of byGap) {
    attempts.sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
    const g = gapById.get(gapId);
    threads.push({
      gapId,
      summary: str(g?.["summary"]),
      status: str(g?.["status"]),
      severity: str(g?.["severity"]),
      reopenCount: typeof g?.["reopen_count"] === "number" ? (g["reopen_count"] as number) : 0,
      detectedAt: str(g?.["first_detected_at"]) ?? str(g?.["detected_at"]),
      closedAt: str(g?.["closed_at"]),
      attempts: attempts.slice(0, perThread),
      attemptCount: attempts.length,
      landedCount: attempts.filter((a) => a.landed).length,
      lastAt: attempts[0]?.at ?? null,
    });
  }
  threads.sort((a, b) => (b.lastAt ?? "").localeCompare(a.lastAt ?? ""));
  return threads.slice(0, maxThreads);
}
