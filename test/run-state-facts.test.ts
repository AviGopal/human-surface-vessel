/**
 * A run's state and the lines around it come from fields the surface read,
 * never from its own reading of log text: `waiting` only from an open question
 * linked to the run, `stalled` with the silence that made it so, a pooled
 * reference with no claim about where its content is.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://surface.test/" });

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import fixture from "./fixtures/chain-fb068805.json";
import type { Question } from "../ui/src/api/participation";
import { deriveRunState, rowReason, stalledForMs, STALL_AFTER_MS, type RunFacts } from "../ui/src/lib/runState";
import { openRunQuestion } from "../ui/src/lib/walk";

const NOW = 1_000_000;

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
    ...(run ? { run: { dispatchId: "d1", solicitationId: "s1", deadlineAt: NOW + 60_000, linked: true, ...run } } : {}),
    ...extra,
  };
}

describe("openRunQuestion", () => {
  test("an open question linked to the run is found", () => {
    expect(openRunQuestion([question({})], "d1", NOW)?.id).toBe("q1");
  });

  test("must-fail: no question, unlinked, another run, answered, declined or past deadline is not open", () => {
    expect(openRunQuestion(undefined, "d1", NOW)).toBeNull();
    expect(openRunQuestion([question(undefined)], "d1", NOW)).toBeNull();
    expect(openRunQuestion([question({ linked: false })], "d1", NOW)).toBeNull();
    expect(openRunQuestion([question({ dispatchId: "d2" })], "d1", NOW)).toBeNull();
    expect(openRunQuestion([question({}, { answered: true })], "d1", NOW)).toBeNull();
    expect(openRunQuestion([question({}, { declined: true })], "d1", NOW)).toBeNull();
    expect(openRunQuestion([question({ deadlineAt: NOW - 1 })], "d1", NOW)).toBeNull();
  });

  test("a null clock skips the stored deadline (an open run view heartbeats it)", () => {
    expect(openRunQuestion([question({ deadlineAt: NOW - 1 })], "d1", null)?.id).toBe("q1");
  });
});

const running: RunFacts = { status: "running", reached: null, awaitingAnswer: false, hasProgress: true, quietForMs: 0, acceptedForMs: 0 };

describe("stalledForMs", () => {
  test("a quiet run carries its silence; a silent accept carries its age", () => {
    expect(stalledForMs({ ...running, quietForMs: STALL_AFTER_MS + 5_000 })).toBe(STALL_AFTER_MS + 5_000);
    expect(stalledForMs({ ...running, hasProgress: false, quietForMs: 0, acceptedForMs: 400_000 })).toBe(400_000);
  });

  test("must-fail: any other state carries nothing", () => {
    expect(stalledForMs(running)).toBeNull();
    expect(stalledForMs({ ...running, awaitingAnswer: true, quietForMs: STALL_AFTER_MS * 10 })).toBeNull();
    expect(deriveRunState({ ...running, awaitingAnswer: true, quietForMs: STALL_AFTER_MS * 10 })).toBe("waiting");
  });
});

describe("rowReason", () => {
  test("the judge's reason or the error, as written; nothing of the surface's own", () => {
    expect(rowReason({ goalReachReason: " no chart " })).toBe("no chart");
    expect(rowReason({ goalReachReason: null, error: "timeout" })).toBe("timeout");
    expect(rowReason({ goalReachReason: "  " })).toBeNull();
  });
});

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
