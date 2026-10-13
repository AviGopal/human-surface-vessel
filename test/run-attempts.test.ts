/**
 * A run shows how it went from its first attempt to the reported one, one line
 * each under its title; and an "answer" that is only the judge's reason is
 * labelled a verdict. Shape: dispatch d21c4aef (10-12), "What gaps are we
 * closing?": attempt 1 hollow, retried, attempt 2 reached; its answer body is
 * the reach reason over raw records.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://surface.test/" });

import { afterAll, describe, expect, test } from "bun:test";
import fixture from "./fixtures/chain-fb068805.json";

const REASON = "The outputs successfully identify and address operational gaps, fulfilling the intent of the goal.";
const GOAL = "What gaps are we closing?";
const walk = {
  poolProvenance: [],
  steps: [],
  poolShapes: [],
  pendingTargets: [],
  ...fixture,
  dispatchId: "d-att",
  goal: GOAL,
  status: "completed",
  reached: true,
  goalReachReason: REASON,
  answerBody: `# ${GOAL}\n${REASON}\n## Basis\n\n{"gaps":[]}`,
  poolEvents: [
    { shape: "goal", source: "goal", at: 1000 },
    { shape: "dispatch_id", source: "seed var dispatch_id", at: 1001 },
    { shape: "shellResult", source: "produced by activity:shell", at: 5000 },
    { shape: "goal", source: "goal", at: 30000 },
    { shape: "dispatch_id", source: "seed var dispatch_id", at: 30001 },
    { shape: "substrateGap_write", source: "vessel-resolve satisfier (substrateGap_write)", at: 40000 },
  ],
  walkLog: [
    "walk(/run-goal): HOLLOW — The output does not provide a meaningful answer to the question of what gaps are being closed.; β WITHHELD",
    "/run-goal: walk: FEEDBACK-RETRY — re-running the same chain with the prior verdict fed into synthesis",
    "REACHED via 2-step chain",
  ],
};

globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = String(input);
  if (url.includes("/api/questions")) return new Response(JSON.stringify({ resolved: true, success: true, body: { questions: [] } }), { status: 200 });
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
const { answerIsVerdict } = await import("../ui/src/components/Answer");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function mount(): Promise<HTMLElement> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    createRoot(el).render(
      React.createElement(
        QueryClientProvider,
        { client: qc },
        React.createElement(LiveControlsProvider, null, React.createElement(QuestionsProvider, null, React.createElement(RunView, { dispatchId: "d-att" }))),
      ),
    );
  });
  for (let i = 0; i < 3; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
  }
  return el;
}

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

describe("the attempts strip", () => {
  test("one line per attempt: the rejection, why the next began, what each produced, and the reach", async () => {
    const el = await mount();
    const lines = [...el.querySelectorAll("[aria-label='Attempts'] li")];
    expect(lines.length).toBe(2);
    expect(lines[0]?.getAttribute("data-outcome")).toBe("rejected");
    expect(lines[0]?.textContent).toContain("does not provide a meaningful answer");
    expect(lines[0]?.textContent).toContain("shellResult");
    expect(lines[1]?.getAttribute("data-outcome")).toBe("reached");
    expect(lines[1]?.textContent).toContain("retried with the prior verdict");
    expect(lines[1]?.textContent).toContain("substrateGap_write");
  });
});

describe("the answer header", () => {
  test("must-fail: an answer that is only the judge's reason is labelled a verdict; what the run produced leads as the answer", async () => {
    const el = await mount();
    const verdict = el.querySelector("[aria-label='Verdict']");
    const answer = el.querySelector("[aria-label='Answer']");
    expect(verdict).not.toBeNull();
    expect(verdict?.className).toContain("sf-verdict-compact");
    expect(answer).not.toBeNull();
    expect(answer?.textContent).not.toContain(REASON);
    // The answer comes first, and its output is not drawn a second time under Outputs.
    expect(answer!.compareDocumentPosition(verdict!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const outputs = el.querySelector("[aria-label='Outputs']")?.textContent ?? "";
    const firstLine = (answer?.textContent ?? "").slice(0, 30);
    expect(firstLine.length).toBeGreaterThan(0);
    expect(outputs).not.toContain(firstLine);
  });

  test("an answer with its own text stays an answer", () => {
    expect(answerIsVerdict(`# ${GOAL}\nThree gaps are open: a, b, c.\n## Basis\n\n…`, GOAL, REASON)).toBe(false);
    expect(answerIsVerdict(`# ${GOAL}\n${REASON}\n## Basis\n\n…`, GOAL, REASON)).toBe(true);
    expect(answerIsVerdict(`${REASON}`, GOAL, null)).toBe(false);
  });
});
