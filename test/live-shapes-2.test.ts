/**
 * Live shapes from 10-13: a fetched page cut inside its wrapper (558fc260), a
 * numbered list split by sub-bullets (beb99adc), wrapper metadata as fields
 * (a84097d5), and a model answer that sits outside the run's outputs (ad9a96b1).
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://surface.test/" });

import { afterAll, describe, expect, test } from "bun:test";
import { teardownDom, trackRoot } from "./setup.ts";
import type { GoalWalkState } from "../ui/src/api/types";
import { findMarkup, planContent } from "../ui/src/lib/ledger";

globalThis.fetch = (async () => new Response("{}", { status: 200 })) as typeof fetch;

const uiSrc = new URL("../ui/src/", import.meta.url).pathname;
const from = (spec: string): string => Bun.resolveSync(spec, uiSrc);
const React = await import(from("react"));
const { createRoot: rawCreateRoot } = await import(from("react-dom/client"));
const createRoot = (...a: Parameters<typeof rawCreateRoot>) => trackRoot(rawCreateRoot(...a));
const { act } = React;
const { QueryClient, QueryClientProvider } = await import(from("@tanstack/react-query"));
const { LiveControlsProvider } = await import("../ui/src/state/liveControls");
const { Chain } = await import("../ui/src/components/Chain");
const { Prose } = await import("../ui/src/components/Prose");
const { Rendered } = await import("../ui/src/components/Rendered");
const { OnScreenProvider, useOnScreen } = await import("../ui/src/state/onScreen");
const { fromText } = await import("../ui/src/lib/content");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function mount(node: unknown): Promise<HTMLElement> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    createRoot(el).render(React.createElement(QueryClientProvider, { client: qc }, React.createElement(LiveControlsProvider, null, node as never)));
  });
  for (let i = 0; i < 2; i++) await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
  return el;
}

afterAll(async () => {
  await teardownDom();
});

// 558fc260's http_fetch preview: the page inside {success, body:{bodyText}}, cut before </html>.
const PAGE = '<!DOCTYPE html>\n<html lang="en" dir="ltr">\n    <head>\n        <meta charset="utf-8" />\n        <meta name="description" content="Project 507 is a community interest company. Our vision is a society in which violent systems are replaced by ones that produce social justice, and learning belongs to everyone who wants it." />\n        <title>Project 507</title>';
const FETCH = `{"success":true,"shape":"httpResponse","body":{"url":"https://project507.substack.com/","status":200,"ok":true,"contentType":"text/html; charset=utf-8","bodyText":${JSON.stringify(PAGE).slice(0, -1)}`;

function walk(prov: unknown[], reached: boolean | null = false): GoalWalkState {
  return {
    dispatchId: "d", status: "failed", reached, goalReachReason: null, poolShapes: [], pendingTargets: [], poolEvents: [], walkLog: [],
    currentStep: null, steps: [], executionPath: null, walkTier: null, attemptCount: null, grounded: null, learning: null, answerBody: null,
    operator: null, completionShapes: null, humanGraded: false, humanReachNotes: null, trigger: null, requeueOf: null,
    poolProvenance: [{ id: "g", shape: "goal", producedBy: "seed", contentPreview: "q", chars: 1, consumedIds: [] }, ...prov],
  } as unknown as GoalWalkState;
}

describe("a fetched page cut inside its wrapper (558fc260)", () => {
  test("must-fail: it is markup, found inside the wrapper, and never planned as prose", () => {
    expect(findMarkup(FETCH)?.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(planContent("http_fetch", FETCH, true).form).not.toBe("prose");
  });

  test("must-fail: as the answer on screen, it reports markup, so \"as a page\" is taken", async () => {
    let markup: boolean | null = null;
    function Probe(): null {
      const e = useOnScreen();
      if (e) markup = e.markup;
      return null;
    }
    await mount(
      React.createElement(OnScreenProvider, null,
        React.createElement(Rendered, { content: fromText("http_fetch", FETCH, "truncated"), density: "full", header: false, region: "run_answer", lead: true }),
        React.createElement(Probe, null)),
    );
    expect(markup).toBe(true);
  });
});

describe("a numbered list split by sub-bullets (beb99adc)", () => {
  test("must-fail: it keeps the writer's numbers", async () => {
    const el = await mount(React.createElement(Prose, { source: "1. **Natural Language Processing**\n   - parses queries\n2. **Tool Integration**\n   - picks tools\n3. **Task Execution**" }));
    expect([...el.querySelectorAll("ol")].map((o) => o.getAttribute("start"))).toEqual(["1", "2", "3"]);
  });
});

describe("wrapper metadata (a84097d5)", () => {
  test("must-fail: shown as field chips, not a raw JSON line", () => {
    const rec = JSON.stringify({
      success: true,
      shape: "concept_write",
      body: { id: "concept:concept_Nj13", content: "The article discusses the belief that learning should be accessible to everyone." },
      metadata: { shape: "concept_write_result", summary: "Concept concept:concept_Nj13 created from http_fetch source", concept_id: "concept:concept_Nj13", source_type: "http_fetch", auditImpulseId: "impulse:impulse_g5Gz" },
    });
    const meta = planContent("concept_write", rec, false).meta ?? [];
    expect(meta.some((m) => m.kind === "note" && m.text.startsWith("{"))).toBe(false);
    expect(meta).toContainEqual({ kind: "field", key: "source_type", text: "http_fetch" });
  });
});

describe("a model answer outside the run's outputs (ad9a96b1)", () => {
  test("must-fail: readable prose leads open even when a record is the run's output", async () => {
    const gaps = JSON.stringify({ gaps: [{ id: "detector-coverage-dormant", status: "open" }] });
    const el = await mount(
      React.createElement(Chain, {
        walk: walk([
          { id: "x", shape: "substrateGap", producedBy: "activity:t", contentPreview: gaps, chars: 125731, consumedIds: ["g"] },
          { id: "p", shape: "llm_completion_result", producedBy: "activity:⟨auto-bridge-source_code⟩", contentPreview: "We have learned that recent advancements in artificial intelligence are enabling machines to understand and generate human language with remarkable accuracy. This includes improvements in natural language processing, machine learning algorithms, and the ability to analyze vast amounts of data quickly.", chars: 867, consumedIds: [] },
        ]),
      }),
    );
    const open = [...el.querySelectorAll(".sf-chain-output")].map((a) => a.textContent ?? "");
    expect(open.some((t) => t.includes("We have learned that recent advancements"))).toBe(true);
  });
});
