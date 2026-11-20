/**
 * The surface: an ask bar across the top, and the landing the view names below it. A question
 * waiting on the person opens in place on the landing, under its row, so what is being worked
 * on stays in view (interface-as-shapes: asks are answered in their context, through the box).
 * The page never scrolls — the main pane scrolls on its own, and content inside it is never
 * boxed into a scroller of its own.
 *
 * Which question is open is the URL (`/question/:id`), so it survives a reload, can be linked,
 * and the back button means what it should.
 */

import { useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useRenderPolicy, useUiView } from "./api/queries";
import { Landing } from "./components/Landing";
import { TopBar } from "./components/TopBar";
import { boxContext } from "./lib/box";
import { useAskAbout } from "./state/askAbout";
import { useTokenOverrides } from "./lib/useTokenOverrides";
import { useLiveControls } from "./state/liveControls";
import { useStoreStream } from "./state/stream";
import { QuestionsProvider, useQuestions } from "./state/questions";

/**
 * The layout this build renders, published for exposure records. Records made
 * under this layout must not be attributed to the earlier "onepage" grid or the
 * "workbench" grid with its questions rail.
 */
const PRESENTATION = "landing";

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

  const questions = useQuestions();

  // Nothing selected: the landing, drawn from its view.
  const landingView = useUiView("landing", { enabled: !paused, intervalMs });

  // The box answers a walk step's question (human_input) open in place on the landing, unless the
  // person set it aside. Other questions carry their own forms, so the box stays a new ask there.
  const [setAside, setSetAside] = useState<string | null>(null);
  const open = questionId ? (questions.query.data?.questions.find((q) => q.id === questionId && q.run !== undefined && !q.answered && !q.declined) ?? null) : null;
  // A listed ask the person chose to ask about: the box's next ask cites it, until it is sent or set aside.
  const [about, clearAbout] = useAskAbout();
  const context = boxContext(open, open?.title ?? null, setAside, about);

  // Opening the open question again closes it.
  const openQuestion = (id: string): void => {
    void (id === questionId ? navigate({ to: "/" }) : navigate({ to: "/question/$questionId", params: { questionId: id } }));
  };

  return (
    <div className="sf-app">
      <h1 className="sf-visually-hidden">Substrate surface</h1>
      <TopBar
        context={context}
        complaintRegion={questionId}
        onSetAside={() => (context.kind === "about" ? clearAbout() : setSetAside(open?.id ?? null))}
        onAsked={clearAbout}
      />

      <main className="sf-main">
        <Landing
          view={landingView.data}
          viewError={landingView.isError ? landingView.error.message : null}
          live={!paused}
          intervalMs={intervalMs}
          onOpenQuestion={openQuestion}
          openQuestion={questionId}
        />
      </main>
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
