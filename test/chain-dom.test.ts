/**
 * The outputs list a person reads: content first, references with no content
 * folded under a count, and never their raw `{producedBy, executionId}` text.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://surface.test/" });

import { afterAll, describe, expect, test } from "bun:test";
import type { GoalWalkState } from "../ui/src/api/types";

globalThis.fetch = (async () => new Response("{}", { status: 200 })) as typeof fetch;

const uiSrc = new URL("../ui/src/", import.meta.url).pathname;
const from = (spec: string): string => Bun.resolveSync(spec, uiSrc);
const React = await import(from("react"));
const { createRoot } = await import(from("react-dom/client"));
const { act } = React;
const { QueryClient, QueryClientProvider } = await import(from("@tanstack/react-query"));
const { LiveControlsProvider } = await import("../ui/src/state/liveControls");
const { Chain } = await import("../ui/src/components/Chain");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const stub = (by: string, exec: string): string => JSON.stringify({ producedBy: by, executionId: exec });

function walk(provenance: unknown[], reached: boolean | null = true): GoalWalkState {
  return {
    dispatchId: "d",
    status: "completed",
    reached,
    goalReachReason: null,
    poolShapes: [],
    poolProvenance: provenance,
    pendingTargets: [],
    poolEvents: [],
    walkLog: [],
    currentStep: null,
    steps: [],
    executionPath: null,
    walkTier: null,
    attemptCount: null,
    grounded: null,
    learning: null,
    answerBody: null,
    operator: null,
    completionShapes: null,
    humanGraded: false,
    humanReachNotes: null,
    trigger: null,
    requeueOf: null,
  } as unknown as GoalWalkState;
}

async function mount(w: GoalWalkState, blind = false): Promise<HTMLElement> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    createRoot(el).render(
      React.createElement(QueryClientProvider, { client: qc }, React.createElement(LiveControlsProvider, null, React.createElement(Chain, { walk: w, blind }))),
    );
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });
  return el;
}

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

const refs = [
  { id: "m", shape: "memoryNote_write", producedBy: "activity:⟨learned⟩", contentPreview: stub("activity:⟨learned⟩", "exec_a"), chars: 127, consumedIds: ["g"] },
  { id: "c", shape: "concept", producedBy: "activity:x", contentPreview: stub("activity:x", "exec_b"), chars: 132, consumedIds: [] },
];

describe("Chain outputs", () => {
  test("must-fail: no row shows a reference's raw text; references fold under a count", async () => {
    const el = await mount(
      walk([
        { id: "g", shape: "goal", producedBy: "seed", contentPreview: "What is project 507?", chars: 20, consumedIds: [] },
        { id: "s", shape: "webSearchResult", producedBy: "satisfier:webSearchResult", contentPreview: "Project 507 is a research programme.", chars: 2969, consumedIds: ["g"] },
        ...refs,
      ]),
    );
    const summaries = [...el.querySelectorAll("summary")].map((s) => s.textContent ?? "").join("\n");
    expect(summaries).not.toContain('"producedBy"');
    expect(summaries).toContain("No content · 2");
    expect(el.querySelector(".sf-chain-output")?.textContent).toContain("Project 507 is a research programme.");
  });

  test("with no terminal output, the largest thing produced leads", async () => {
    const el = await mount(
      walk([
        { id: "s", shape: "webSearchResult", producedBy: "satisfier:webSearchResult", contentPreview: "Found: project 507 results.", chars: 2969, consumedIds: [] },
        { id: "t", shape: "shellResult", producedBy: "activity:y", contentPreview: "ok", chars: 2, consumedIds: [] },
        ...refs,
      ]),
    );
    expect(el.querySelector(".sf-chain-output")?.textContent).toContain("Found: project 507 results.");
  });

  const search = { id: "s", shape: "webSearchResult", producedBy: "satisfier:webSearchResult", contentPreview: "About — Project 507 CIC", chars: 2969, consumedIds: ["g"] };
  const seed = { id: "g", shape: "goal", producedBy: "seed", contentPreview: "What is project 507?", chars: 20, consumedIds: [] };

  test("a finished run that did not reach shows its outputs one line each", async () => {
    const el = await mount(walk([seed, search, ...refs], false));
    expect(el.querySelector(".sf-chain-output")).toBeNull();
    const row = el.querySelector(".sf-chain-collapsed summary")?.textContent ?? "";
    expect(row).toContain("webSearchResult");
    expect(row).toContain("About — Project 507 CIC");
  });

  test("must-fail: the blind view's layout does not depend on the verdict", async () => {
    const reachedEl = await mount(walk([seed, search], true), true);
    const notEl = await mount(walk([seed, search], false), true);
    expect(notEl.querySelector(".sf-chain-collapsed")).toBeNull();
    expect(notEl.querySelectorAll(".sf-chain-output").length).toBe(reachedEl.querySelectorAll(".sf-chain-output").length);
  });
});
