/**
 * The rendered run carries the facts and nothing guessed: no `waiting` from a
 * log line, `waiting` from an open linked question, `stalled` with its
 * silence, a pooled reference with no claim about where its content is.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://surface.test/" });

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import fixture from "./fixtures/chain-fb068805.json";
import type { Question } from "../ui/src/api/participation";

function question(run: Partial<NonNullable<Question["run"]>> | undefined, extra: Partial<Question> = {}): Question {
  return {
    id: "q1",
    revision: 1,
    title: "t",
    body: "b",
    createdAt: 0,
    updatedAt: 0,
    responses: [],
    answered: false,
    declined: false,
    ...(run ? { run: { dispatchId: "d1", solicitationId: "s1", deadlineAt: null, linked: true, ...run } } : {}),
    ...extra,
  };
}

// ── in a DOM ────────────────────────────────────────────────────────────────

const LOG = [
  "[goal-host-vessel] walk: candidates for human_input: none advertised locally",
  "[goal-host-vessel] walk: human solicitation outcome=timeout — proceeding to honest failure",
];
const walk = {
  poolEvents: [],
  steps: [],
  poolShapes: [],
  pendingTargets: [],
  ...fixture,
  dispatchId: "d1",
  status: "running",
  reached: null,
  walkLog: LOG,
};
let questions: Question[] = [];

globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = String(input);
  if (url.includes("/api/questions")) {
    return new Response(JSON.stringify({ resolved: true, success: true, body: { questions } }), { status: 200 });
  }
  if (url.includes("/api/resolve")) return new Response(JSON.stringify({ resolved: true, shape: "goalWalkState", body: walk }), { status: 200 });
  return new Response("{}", { status: 200 });
}) as typeof fetch;

const uiSrc = new URL("../ui/src/", import.meta.url).pathname;
const from = (spec: string): string => Bun.resolveSync(spec, uiSrc);
const React = await import(from("react"));
const { createRoot } = await import(from("react-dom/client"));
const { act } = React;
const { QueryClient, QueryClientProvider } = await import(from("@tanstack/react-query"));
const { LiveControlsProvider } = await import("../ui/src/state/liveControls");
const { QuestionsProvider } = await import("../ui/src/state/questions");
const { RunView } = await import("../ui/src/components/RunView");
const { StateBadge } = await import("../ui/src/components/StateBadge");
const { Rendered } = await import("../ui/src/components/Rendered");
const { fromText } = await import("../ui/src/lib/content");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function mount(node: unknown): Promise<HTMLElement> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    createRoot(el).render(
      React.createElement(
        QueryClientProvider,
        { client: qc },
        React.createElement(LiveControlsProvider, null, React.createElement(QuestionsProvider, null, node as never)),
      ),
    );
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 40));
  });
  return el;
}

beforeEach(() => {
  questions = [];
});

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

describe("RunView", () => {
  test("must-fail: a log that names human_input, with no linked question, is not waiting", async () => {
    const el = await mount(React.createElement(RunView, { dispatchId: "d1" }));
    expect(el.querySelector("article.sf-run")?.getAttribute("data-state")).not.toBe("waiting");
    expect(el.querySelector(".sf-view-head .sf-verdict")?.getAttribute("data-state")).not.toBe("waiting");
    expect(el.textContent).not.toContain("Waiting on you");
  });

  test("an open question linked to the run is waiting", async () => {
    questions = [question({ deadlineAt: Date.now() + 60_000 })];
    const el = await mount(React.createElement(RunView, { dispatchId: "d1" }));
    expect(el.querySelector("article.sf-run")?.getAttribute("data-state")).toBe("waiting");
  });
});

describe("StateBadge", () => {
  test("stalled carries the silence beside the word", async () => {
    const el = await mount(React.createElement(StateBadge, { state: "stalled", quietForMs: 240_000 }));
    expect(el.textContent).toContain("stalled");
    expect(el.textContent).toContain("quiet 4m 0s");
  });
});

describe("a pooled reference", () => {
  test("must-fail: says what is known and claims nothing about where content is", async () => {
    const stub = '{"producedBy":"activity:⟨compose⟩","executionId":"exec_1"}';
    const el = await mount(React.createElement(Rendered, { content: fromText("substrateGap", stub) }));
    const text = el.textContent ?? "";
    expect(text).toContain("compose");
    expect(text).toContain("no content");
    expect(text).toContain("exec_1");
    expect(text).not.toContain("Pointer only");
    expect(text).not.toContain("not carried");
  });
});
