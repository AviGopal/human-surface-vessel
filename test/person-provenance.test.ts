/**
 * Input under a person-resolved shape is a person's only when this surface
 * delivered the run's question and holds the answer: provenance, not the name.
 * A stand-in is labelled, not hidden (user rulings 10-17). Fixture: a reached run
 * whose human_input was produced by a satisfier (its content an empty concept
 * search) and credited, with no question ever asked.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://surface.test/" });

import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// The fixture keeps only what the page reads from the run; the rest are the serializer's empty defaults.
const walk = {
  pendingTargets: [], poolEvents: [], walkLog: [], currentStep: null, steps: [], walkTier: null, grounded: null,
  operator: "human-surface", humanGraded: false, humanReachNotes: null, trigger: null, requeueOf: null,
  ...(JSON.parse(readFileSync(new URL("./fixtures/fabricated-person-walk.json", import.meta.url), "utf8")) as Record<string, unknown>),
};
const dispatchId = String(walk["dispatchId"]);
let questions: unknown[] = [];
const grades: Record<string, unknown>[] = [];

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.includes("/api/person-shapes")) return new Response(JSON.stringify({ resolved: true, body: { shapes: ["human_input"] } }), { status: 200 });
  if (url.includes("/api/questions")) return new Response(JSON.stringify({ resolved: true, success: true, body: { questions } }), { status: 200 });
  if (url.includes("/api/verdicts")) return new Response(JSON.stringify({ body: { verdicts: [] } }), { status: 200 });
  if (url.includes("/api/grade")) {
    grades.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
    return new Response("{}", { status: 200 });
  }
  if (url.includes("/api/resolve")) return new Response(JSON.stringify({ resolved: true, shape: "goalWalkState", body: walk }), { status: 200 });
  return new Response("{}", { status: 200 });
}) as typeof fetch;

const uiSrc = new URL("../ui/src/", import.meta.url).pathname;
const React = await import(Bun.resolveSync("react", uiSrc));
const { createRoot } = await import(Bun.resolveSync("react-dom/client", uiSrc));
const { act } = React;
const { QueryClient, QueryClientProvider } = await import(Bun.resolveSync("@tanstack/react-query", uiSrc));
const { LiveControlsProvider } = await import("../ui/src/state/liveControls");
const { QuestionsProvider } = await import("../ui/src/state/questions");
const { RunView } = await import("../ui/src/components/RunView");
const { personProvenance } = await import("../ui/src/lib/provenance");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterAll(async () => {
  await GlobalRegistrator.unregister();
});

async function mount(): Promise<HTMLElement> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    createRoot(el).render(
      React.createElement(QueryClientProvider, { client: qc }, React.createElement(LiveControlsProvider, null, React.createElement(QuestionsProvider, null, React.createElement(RunView, { dispatchId })))),
    );
  });
  for (let i = 0; i < 4; i++) await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
  return el;
}

const answered = { id: "solicitation-s", revision: 1, title: "q", body: "q", createdAt: 0, updatedAt: 0, responses: [], answered: true, declined: false, run: { dispatchId, solicitationId: "s", deadlineAt: null, linked: true } };

describe("person provenance", () => {
  test("the rule reads provenance, not names", () => {
    expect(personProvenance("human_input", ["human_input"], [], dispatchId)).toBe("without-a-person");
    expect(personProvenance("human_input", ["human_input"], [answered as never], dispatchId)).toBe("from-a-person");
    expect(personProvenance("human_context", ["human_input"], [], dispatchId)).toBeNull();
    expect(personProvenance("web_search", ["human_input"], [], dispatchId)).toBeNull();
  });

  test("must-fail: a stand-in's person input is shown, labelled no person asked, and a grade carries what it judged", async () => {
    questions = [];
    const el = await mount();
    const answer = el.querySelector("[aria-label='Answer']");
    expect(answer).not.toBeNull();
    expect(answer?.querySelector(".sf-person-mark")?.textContent).toBe("no person asked");
    // Shown, not hidden: the content is still drawn.
    expect(answer?.textContent).toContain("raining");
    // Grade it: the write names the result and its provenance.
    const option = el.querySelector("input[type='radio'][value='Wrong answer']") as HTMLInputElement;
    await act(async () => {
      option.click();
    });
    await act(async () => {
      (el.querySelector("form.sf-grade") as HTMLFormElement).requestSubmit();
    });
    for (let i = 0; i < 3; i++) await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(grades.at(-1)?.["about"]).toMatchObject({ shape: "human_input", produced_by: "satisfier:human_input", provenance: "without-a-person" });
    expect(grades.at(-1)?.["dispatch_id"]).toBe(dispatchId);
  });

  test("with the run's question answered here, the same input is the person's", async () => {
    questions = [answered];
    const el = await mount();
    expect(el.querySelector("[aria-label='Answer'] .sf-person-mark")?.textContent).toBe("your answer");
  });
});
