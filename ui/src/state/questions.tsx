/**
 * The system's questions, held above the rail and the main pane so both read
 * one accepted snapshot.
 *
 * P3 holds here as it does on the runs board: after first paint, a newer server
 * list is not spliced in — it is offered, and accepted by the reader. Exposure
 * ticks count accepted presentations, so they fire from the list component
 * (see QuestionsList), not from this provider.
 */

import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { fetchQuestions, type ParticipationResponse, type Question, type QuestionPage, type Ranking } from "../api/participation";
import { reportExposureAct } from "../lib/exposure-reporter";
import { sortRuns } from "../lib/sort";
import { useLiveControls } from "./liveControls";
import { streamAwareInterval, useStreamConnected } from "./stream";

export interface QuestionGroup {
  readonly kind: string;
  readonly label: string;
  readonly questions: readonly Question[];
}

interface QuestionsValue {
  readonly query: UseQueryResult<QuestionPage>;
  /** Importance order when the server ranked every row; recency otherwise. */
  readonly ordered: readonly Question[];
  readonly groups: readonly QuestionGroup[];
  readonly ranking: Ranking | null;
  readonly waiting: number;
  /** The server holds content this reader has not accepted. */
  readonly changed: boolean;
  /** Increments each time a server snapshot is accepted for display. */
  readonly acceptedTicks: number;
  readonly accept: () => Promise<void>;
  readonly recordReceipt: (receipt: ParticipationResponse) => void;
}

const QuestionsContext = createContext<QuestionsValue | null>(null);

const KIND_LABELS: Readonly<Record<string, string>> = {
  gap_needs_human: "Needs your decision",
  gap_reland_needs_human: "Fixes that keep failing",
  gap_pending_verification: "Did the fix work?",
  gap_needs_localization: "Where should the change go?",
  question: "Questions",
  code_change: "Code changes",
};

export function kindLabel(kind: string | undefined): string {
  if (!kind) return "Other";
  const known = KIND_LABELS[kind];
  if (known) return known;
  const words = kind.replace(/^gap_/, "").replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Rank and `because` are recomputed on every read and move as a consequence of
 * the reader's own answer, and order is not content — so neither may trigger
 * "updates available".
 */
function contentOf(questions: readonly Question[]): string {
  return JSON.stringify(
    [...questions]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((question) => {
        const copy: Record<string, unknown> = { ...question };
        delete copy["rank"];
        delete copy["because"];
        return copy;
      }),
  );
}

function orderQuestions(visible: readonly Question[]): readonly Question[] {
  const keyed = visible.map((q) => ({ ...q, dispatchId: q.id, startedAtMs: q.createdAt }));
  const everyRowRanked =
    keyed.length > 0 && keyed.every((q) => typeof q.rank === "number" && Number.isFinite(q.rank));
  return everyRowRanked
    ? [...keyed].sort(
        (a, b) =>
          (a.rank as number) - (b.rank as number) ||
          (a.dispatchId < b.dispatchId ? -1 : a.dispatchId > b.dispatchId ? 1 : 0),
      )
    : sortRuns(keyed);
}

/** Groups keep the importance order: a group sits where its best row would. */
function groupQuestions(ordered: readonly Question[]): readonly QuestionGroup[] {
  const byKind = new Map<string, Question[]>();
  for (const q of ordered) {
    const kind = q.kind ?? "other";
    const list = byKind.get(kind);
    if (list) list.push(q);
    else byKind.set(kind, [q]);
  }
  return [...byKind.entries()].map(([kind, questions]) => ({
    kind,
    label: kindLabel(kind === "other" ? undefined : kind),
    questions,
  }));
}

export function QuestionsProvider({ children }: { children: ReactNode }): ReactNode {
  const { paused, intervalMs } = useLiveControls();
  const live = useStreamConnected();
  const query = useQuery({
    queryKey: ["humanQuestions"],
    queryFn: fetchQuestions,
    enabled: !paused,
    refetchInterval: !paused ? streamAwareInterval(Math.max(intervalMs, 5000), live) : false,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const [snapshot, setSnapshot] = useState<Question[] | null>(null);
  const [ranking, setRanking] = useState<Ranking | null>(null);
  const [acceptedTicks, setAcceptedTicks] = useState(0);

  useEffect(() => {
    if (snapshot === null && query.data) {
      setSnapshot(query.data.questions);
      setRanking(query.data.ranking);
      setAcceptedTicks((n) => n + 1);
    }
  }, [snapshot, query.data]);

  const accept = useCallback(async () => {
    const result = await query.refetch();
    if (result.data && !result.isError) {
      setSnapshot(result.data.questions);
      setRanking(result.data.ranking);
      setAcceptedTicks((n) => n + 1);
    }
  }, [query]);

  const recordReceipt = useCallback(
    (receipt: ParticipationResponse) => {
      // Answered and declined stay distinct; an ask-level act keeps its ask id.
      reportExposureAct(receipt.panelId, receipt.kind === "dismiss" ? "declined" : "answered", receipt.askId);
      setSnapshot(
        (previous) =>
          previous?.map((question) => {
            if (question.id !== receipt.panelId || question.revision !== receipt.panelRevision) return question;
            const responses = [...question.responses.filter((r) => r.id !== receipt.id), receipt];
            const current = responses.filter((r) => (r.panelRevision ?? 1) === question.revision);
            const answers = current.filter((r) => r.kind === "answer");
            return {
              ...question,
              responses,
              answers,
              answered:
                answers.some((r) => !r.askId) ||
                Boolean(question.asks?.length && question.asks.every((part) => answers.some((r) => r.askId === part.id))),
              declined: current.some((r) => r.kind === "dismiss" && !r.askId),
            };
          }) ?? null,
      );
      void query.refetch();
    },
    [query],
  );

  const value = useMemo<QuestionsValue>(() => {
    const visible = snapshot ?? [];
    const ordered = orderQuestions(visible);
    return {
      query,
      ordered,
      groups: groupQuestions(ordered),
      ranking,
      waiting: visible.filter((q) => !q.answered && !q.declined).length,
      changed: snapshot !== null && query.data !== undefined && contentOf(query.data.questions) !== contentOf(visible),
      acceptedTicks,
      accept,
      recordReceipt,
    };
  }, [snapshot, query, ranking, acceptedTicks, accept, recordReceipt]);

  return <QuestionsContext.Provider value={value}>{children}</QuestionsContext.Provider>;
}

export function useQuestions(): QuestionsValue {
  const ctx = useContext(QuestionsContext);
  if (!ctx) throw new Error("useQuestions must be used inside QuestionsProvider");
  return ctx;
}

/** The one-line subject a gap question is actually about: its `Summary:` clause. */
export function questionSubject(question: Question): string {
  const body = typeof question.body === "string" ? question.body : "";
  const at = body.indexOf("Summary:");
  const raw = at >= 0 ? body.slice(at + "Summary:".length) : body;
  const subject = raw.replace(/^\s*\[narrowed from [^\]]*\]\s*/, "").trim();
  return subject.length > 0 ? subject : question.title;
}

/** The gap id a gap question names, if it names one. */
export function questionGapId(question: Question): string | null {
  const body = typeof question.body === "string" ? question.body : "";
  const match = /^(?:Gap|Localization failed for gap) ([^\s:(]+)/.exec(body);
  return match?.[1] ?? null;
}
