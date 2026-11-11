/**
 * The surface: an ask bar across the top, a rail listing the questions put to a person, and
 * one main pane showing the open question or, with none open, the landing the view names.
 * The page never scrolls — the rail and the main pane each scroll on their own, and content
 * inside the main pane is never boxed into a scroller of its own.
 *
 * What is open is the URL (`/question/:id`), so it survives a reload, can be linked, and the
 * back button means what it should.
 */

import { useNavigate, useParams } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useRenderPolicy, useUiView } from "./api/queries";
import { IssuesDrawer, useInterfaceGaps } from "./components/IssuesDrawer";
import { QuestionsList } from "./components/QuestionsList";
import { QuestionView } from "./components/QuestionView";
import { Landing } from "./components/Landing";
import { TopBar } from "./components/TopBar";
import { boxContext } from "./lib/box";
import { useTokenOverrides } from "./lib/useTokenOverrides";
import { useLiveControls } from "./state/liveControls";
import { useStoreStream } from "./state/stream";
import { QuestionsProvider, useQuestions } from "./state/questions";
import { OnScreenProvider } from "./state/onScreen";

/**
 * The layout this build renders, published for exposure records. Records made
 * under this layout must not be attributed to the earlier "onepage" grid.
 */
const PRESENTATION = "workbench";

function Workbench(): ReactNode {
  const { paused, intervalMs } = useLiveControls();
  useStoreStream(paused);
  const policy = useRenderPolicy({ enabled: !paused, intervalMs }).data;
  useTokenOverrides(policy?.tokenOverrides);
  useEffect(() => {
    document.documentElement.dataset["presentation"] = PRESENTATION;
  }, []);

  const navigate = useNavigate();
  const params = useParams({ strict: false }) as { questionId?: string };
  const questionId = params.questionId ?? null;
  const [issuesOpen, setIssuesOpen] = useState(false);
  const closeIssues = useCallback(() => setIssuesOpen(false), []);

  const questions = useQuestions();
  const gaps = useInterfaceGaps();
  const openGaps = gaps.data ? gaps.data.filter((g) => g.status !== "closed").length : null;

  // Nothing selected: the landing, drawn from its view.
  const landingView = useUiView("landing", { enabled: !paused, intervalMs });

  // The box answers a walk step's question (human_input) open on the questions page, unless the
  // person set it aside. Other questions carry their own forms, so the box stays a new ask there.
  const [setAside, setSetAside] = useState<string | null>(null);
  const open = questionId ? (questions.query.data?.questions.find((q) => q.id === questionId && q.run !== undefined && !q.answered && !q.declined) ?? null) : null;
  const context = boxContext(open, open?.title ?? null, setAside);

  const openQuestion = (id: string): void => {
    setIssuesOpen(false);
    void navigate({ to: "/question/$questionId", params: { questionId: id } });
  };

  return (
    <div className="sf-app">
      <h1 className="sf-visually-hidden">Substrate surface</h1>
      <TopBar
        context={context}
        complaintRegion={questionId}
        onSetAside={() => setSetAside(open?.id ?? null)}
        openIssues={openGaps}
        issuesOpen={issuesOpen}
        onToggleIssues={() => setIssuesOpen((v) => !v)}
      />

      <nav className="sf-rail" aria-label="Questions">
        <h2 className="sf-rail-head">
          Questions{questions.waiting > 0 ? <span className="sf-count" data-attention="true">{questions.waiting}</span> : null}
        </h2>
        <QuestionsList selectedId={questionId} onSelect={openQuestion} />
      </nav>

      <main className="sf-main">
        {questionId ? (
          <QuestionView questionId={questionId} />
        ) : (
          <Landing
            view={landingView.data}
            viewError={landingView.isError ? landingView.error.message : null}
            live={!paused}
            intervalMs={intervalMs}
            onOpenQuestion={openQuestion}
          />
        )}
      </main>
      {issuesOpen ? <IssuesDrawer onClose={closeIssues} /> : null}
    </div>
  );
}

export function Surface(): ReactNode {
  return (
    <QuestionsProvider>
      <OnScreenProvider>
        <Workbench />
      </OnScreenProvider>
    </QuestionsProvider>
  );
}
