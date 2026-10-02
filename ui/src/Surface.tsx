/**
 * The surface: an ask bar across the top, a rail listing runs or the system's
 * questions, and one main pane showing whichever is open. The page never
 * scrolls — the rail and the main pane each scroll on their own, and content
 * inside the main pane is never boxed into a scroller of its own.
 *
 * What is open is the URL (`/run/:id`, `/question/:id`), so it survives a
 * reload, can be linked, and the back button means what it should.
 */

import { useNavigate, useParams } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useBoard, useRenderPolicy } from "./api/queries";
import { IssuesDrawer, useInterfaceGaps } from "./components/IssuesDrawer";
import { QuestionsList } from "./components/QuestionsList";
import { QuestionView } from "./components/QuestionView";
import { RunsList, type RunFilter } from "./components/RunsList";
import { RunView } from "./components/RunView";
import { TopBar } from "./components/TopBar";
import { useTokenOverrides } from "./lib/useTokenOverrides";
import { useLiveControls } from "./state/liveControls";
import { useStoreStream } from "./state/stream";
import { QuestionsProvider, useQuestions } from "./state/questions";

/**
 * The layout this build renders, published for exposure records. Records made
 * under this layout must not be attributed to the earlier "onepage" grid.
 */
const PRESENTATION = "workbench";

type Tab = "runs" | "questions";

const FILTERS: readonly { id: RunFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "mine", label: "Mine" },
  { id: "system", label: "System" },
];

function Workbench(): ReactNode {
  const { paused, intervalMs } = useLiveControls();
  useStoreStream(paused);
  const policy = useRenderPolicy({ enabled: !paused, intervalMs }).data;
  useTokenOverrides(policy?.tokenOverrides);
  useEffect(() => {
    document.documentElement.dataset["presentation"] = PRESENTATION;
  }, []);

  const navigate = useNavigate();
  const params = useParams({ strict: false }) as { dispatchId?: string; questionId?: string };
  const runId = params.dispatchId ?? null;
  const questionId = params.questionId ?? null;

  const [tab, setTab] = useState<Tab>(questionId ? "questions" : "runs");
  useEffect(() => {
    if (questionId) setTab("questions");
    else if (runId) setTab("runs");
  }, [questionId, runId]);

  const [filter, setFilter] = useState<RunFilter>("all");
  const [issuesOpen, setIssuesOpen] = useState(false);
  const [highlightIssue, setHighlightIssue] = useState<string | null>(null);
  const closeIssues = useCallback(() => {
    setIssuesOpen(false);
    setHighlightIssue(null);
  }, []);
  // A filed report asks to be shown: open the drawer on it (see ComplainButton showIssue).
  useEffect(() => {
    const onShow = (e: Event): void => {
      const id = (e as CustomEvent<unknown>).detail;
      if (typeof id !== "string") return;
      setHighlightIssue(id);
      setIssuesOpen(true);
    };
    window.addEventListener("sf:show-issue", onShow);
    return () => window.removeEventListener("sf:show-issue", onShow);
  }, []);

  const board = useBoard({ enabled: !paused, intervalMs });
  const questions = useQuestions();
  const gaps = useInterfaceGaps();
  const openGaps = gaps.data ? gaps.data.filter((g) => g.status !== "closed").length : null;

  const openRun = (dispatchId: string): void => {
    setIssuesOpen(false);
    void navigate({ to: "/run/$dispatchId", params: { dispatchId } });
  };
  const openQuestion = (id: string): void => {
    setIssuesOpen(false);
    void navigate({ to: "/question/$questionId", params: { questionId: id } });
  };

  return (
    <div className="sf-app">
      <h1 className="sf-visually-hidden">Substrate surface</h1>
      <TopBar
        onDispatched={openRun}
        openIssues={openGaps}
        issuesOpen={issuesOpen}
        onToggleIssues={() => setIssuesOpen((v) => !v)}
      />

      <nav className="sf-rail" aria-label="Runs and questions">
        <div className="sf-tabs" role="tablist">
          <button type="button" role="tab" className="sf-tab" aria-selected={tab === "runs"} onClick={() => setTab("runs")}>
            Runs{board.data ? <span className="sf-count">{board.data.length}</span> : null}
          </button>
          <button
            type="button"
            role="tab"
            className="sf-tab"
            aria-selected={tab === "questions"}
            onClick={() => setTab("questions")}
          >
            Questions{questions.waiting > 0 ? <span className="sf-count" data-attention="true">{questions.waiting}</span> : null}
          </button>
        </div>
        {tab === "runs" ? (
          <>
            <div className="sf-segmented" role="group" aria-label="Show runs">
              {FILTERS.map((f) => (
                <button key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
                  {f.label}
                </button>
              ))}
            </div>
            <RunsList selectedDispatchId={runId} onSelect={openRun} filter={filter} />
          </>
        ) : (
          <QuestionsList selectedId={questionId} onSelect={openQuestion} />
        )}
      </nav>

      <main className="sf-main">
        {runId ? (
          <RunView key={runId} dispatchId={runId} />
        ) : questionId ? (
          <QuestionView questionId={questionId} />
        ) : (
          <p className="sf-main-empty">Select a run or a question</p>
        )}
      </main>
      {issuesOpen ? <IssuesDrawer onClose={closeIssues} highlightId={highlightIssue} /> : null}
    </div>
  );
}

export function Surface(): ReactNode {
  return (
    <QuestionsProvider>
      <Workbench />
    </QuestionsProvider>
  );
}
