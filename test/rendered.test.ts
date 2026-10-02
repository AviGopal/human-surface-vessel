/**
 * <Rendered> in a DOM: the frame survives a renderer that throws, the three
 * densities draw one form, and only reading densities record a decision.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://surface.test/" });

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

const posted: { url: string; body: string }[] = [];
const policy = { tokenOverrides: {}, formByShape: {}, learnedFormByShape: {}, maxPreviewChars: null, ledgerDefaultExpanded: true, revision: 7, updatedAt: 0, note: null };
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (init?.method === "POST") posted.push({ url, body: String(init.body ?? "") });
  if (url.includes("/api/render-policy")) return new Response(JSON.stringify(policy), { status: 200 });
  return new Response("{}", { status: 200 });
}) as typeof fetch;

// Resolve every package exactly as the components under ui/src do, so the
// test and the component share one React and one react-query instance.
const uiSrc = new URL("../ui/src/", import.meta.url).pathname;
const from = (spec: string): string => Bun.resolveSync(spec, uiSrc);
const React = await import(from("react"));
const { createRoot } = await import(from("react-dom/client"));
const { act } = React;
const { QueryClient, QueryClientProvider } = await import(from("@tanstack/react-query"));
const { LiveControlsProvider } = await import("../ui/src/state/liveControls");
const { Rendered, RenderBoundary } = await import("../ui/src/components/Rendered");
const { flushFormDecisions } = await import("../ui/src/lib/exposure-reporter");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function mount(node: unknown): Promise<HTMLElement> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    createRoot(el).render(
      React.createElement(QueryClientProvider, { client: qc }, React.createElement(LiveControlsProvider, null, node as never)),
    );
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
  return el;
}

const envelope = JSON.stringify({ success: true, shape: "gateSelfProbe", body: { outcomes: 3, ok: true } });
const content = { shape: "gate_self_probe", origin: "impulse" as const, body: envelope, state: "full" as const };

beforeAll(() => {
  // Silence the boundary's own console.error for the throwing case.
  console.error = () => {};
});
afterAll(async () => {
  await GlobalRegistrator.unregister();
});

describe("<Rendered>", () => {
  test("a renderer that throws leaves the frame and the verbatim text", async () => {
    function Boom(): never {
      throw new Error("renderer bug");
    }
    const el = await mount(React.createElement(RenderBoundary, { text: "the original bytes" }, React.createElement(Boom)));
    const pre = el.querySelector("pre[data-fallback='true']");
    expect(pre?.textContent).toBe("the original bytes");
  });

  test("one Content draws one form at every density", async () => {
    const forms: string[] = [];
    for (const density of ["row", "inline", "full"] as const) {
      const el = await mount(React.createElement(Rendered, { content, density, region: "evidence_ledger" }));
      const node = el.querySelector("[data-form]");
      forms.push(node?.getAttribute("data-form") ?? "missing");
    }
    expect(forms).toEqual(["record", "record", "record"]);
  });

  test("the wrapper is unwrapped: the body's fields are drawn, not success/shape/body", async () => {
    const el = await mount(React.createElement(Rendered, { content, density: "full", region: "evidence_ledger" }));
    const keys = [...el.querySelectorAll(".sf-record-key")].map((k) => k.textContent);
    expect(keys).toContain("outcomes");
    expect(keys).not.toContain("success");
  });

  test("row density records no form decision; full density does", async () => {
    flushFormDecisions({ rendererBundle: null, presentationVariant: null });
    posted.length = 0;
    await mount(React.createElement(Rendered, { content: { ...content, body: '{"only":"row"}' }, density: "row", region: "rail_row" }));
    flushFormDecisions({ rendererBundle: null, presentationVariant: null });
    expect(posted.filter((p) => p.body.includes("rail_row")).length).toBe(0);

    await mount(React.createElement(Rendered, { content: { ...content, body: '{"full":"yes","n":1}' }, density: "full", region: "evidence_ledger" }));
    flushFormDecisions({ rendererBundle: null, presentationVariant: null });
    const recorded = posted.filter((p) => p.body.includes("evidence_ledger"));
    expect(recorded.length).toBe(1);
    expect(recorded[0]!.body).toContain('"decided_by":"record"');
  });
});

describe("<Prose> machine-record paragraphs", () => {
  test("only a paragraph that is nothing but one code span is set as a record", async () => {
    const { Prose } = await import("../ui/src/components/Prose");
    const el = await mount(React.createElement(Prose, { source: "The tree of `local-tools-vessel` diverges.\n\n`{\"stdout\":\"27\"}`" }));
    const ps = [...el.querySelectorAll("p")];
    expect(ps.length).toBe(2);
    expect(ps[0]?.className).toBe("");
    expect(ps[1]?.className).toBe("sf-prose-record");
  });
});

describe("<Chain>", () => {
  const base = {
    dispatchId: "d-chain-dom", status: "failed", reached: false, goalReachReason: null, poolShapes: [], pendingTargets: [],
    currentStep: null, steps: [], executionPath: null, walkTier: null, attemptCount: null, grounded: null, learning: null,
    answerBody: null, operator: null, completionShapes: null, humanGraded: false, humanReachNotes: null, trigger: null, requeueOf: null,
    poolEvents: [], walkLog: [], goal: "What is happening today?",
  };
  const entry = (id: string, shape: string, producedBy: string, preview: string, consumedIds: string[] = []) => ({
    id, shape, producedBy, producerExecutionId: `exec-${id}`, consumedIds, contentPreview: preview, chars: preview.length, truncated: false,
  });

  test("the output leads, with the impulses it consumed under it; unused output is set aside", async () => {
    const { Chain } = await import("../ui/src/components/Chain");
    const walk = {
      ...base,
      poolProvenance: [
        entry("g", "goal", "seed", '{"goal":"What is happening today?"}'),
        entry("s", "web_search", "satisfier:web_search", '{"shape":"webSearchResult","results":[]}'),
        entry("a", "llm_completion", "satisfier:llm_completion", "Today is Thursday, 1 October 2026.", ["s"]),
        entry("t", "activity_template", "satisfier:activity_template", '{"ok":true}'),
      ],
      routeArounds: [{ kind: "stall", missing_producer: ["obsidian:write_note"], route_taken: "retry:feedback" }],
    };
    const el = await mount(React.createElement(Chain, { walk }));
    const outputs = [...el.querySelectorAll(".sf-chain-output")];
    expect(outputs.length).toBe(1);
    expect(outputs[0]?.textContent).toContain("Today is Thursday, 1 October 2026.");
    expect(outputs[0]?.querySelector(".sf-chain-inputs")?.textContent).toContain("web_search");
    expect(el.querySelector(".sf-chain-unused")?.textContent).toContain("activity_template");
    // The request is not output.
    expect(el.querySelector(".sf-chain-unused")?.textContent).not.toContain("goal");
    expect(el.querySelector(".sf-chain-routes")?.textContent).toContain("obsidian:write_note");
  });

  test("each node shows the credit its producer earned, and the run's credit is summarised", async () => {
    const { Chain } = await import("../ui/src/components/Chain");
    const walk = {
      ...base,
      reached: true,
      poolProvenance: [
        entry("s", "web_search", "satisfier:web_search", '{"shape":"webSearchResult","results":[]}'),
        entry("a", "llm_completion", "satisfier:llm_completion", "Today is Thursday, 1 October 2026.", ["s"]),
      ],
      learning: {
        alphaBetaDelta: [
          { templateId: "satisfier:llm_completion", dAlpha: 1, dBeta: 0 },
          { templateId: "satisfier:web_search", dAlpha: 1, dBeta: 0 },
        ],
        gapsFiled: [],
        goalPathRecorded: true,
      },
    };
    const el = await mount(React.createElement(Chain, { walk }));
    expect(el.querySelector(".sf-chain-output .sf-credit-badge")?.textContent).toContain("+1α");
    expect(el.querySelector(".sf-chain-input .sf-credit-badge")?.textContent).toContain("+1α");
    expect(el.querySelector(".sf-chain-credit summary")?.textContent).toContain("2 credited · 0 penalised");
    expect(el.querySelector(".sf-chain-credit summary")?.textContent).toContain("path recorded");
  });

  test("a run the server has blanked says 'not retained', not empty", async () => {
    const { Chain } = await import("../ui/src/components/Chain");
    const el = await mount(React.createElement(Chain, { walk: { ...base, poolProvenance: [] } }));
    expect(el.textContent).toContain("Not retained");
  });
});
