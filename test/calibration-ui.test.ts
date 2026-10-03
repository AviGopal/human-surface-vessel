/**
 * The blind run shows what a run produced and nothing that carries the system's
 * verdict on it; the report export carries only graded runs of the sample.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://surface.test/" });

import { afterAll, describe, expect, test } from "bun:test";
import fixture from "./fixtures/chain-fb068805.json";

const REASON = "The output provides the current prices, fulfilling the goal's intent.";
const walk = {
  poolEvents: [],
  walkLog: [],
  steps: [],
  poolShapes: [],
  pendingTargets: [],
  ...fixture,
  status: "completed",
  reached: true,
  executionPath: "fresh_derivation",
  goalReachReason: REASON,
  answerBody: `# Goal\n${REASON}\n## Basis\n...`,
  humanGraded: false,
  learning: { alphaBetaDelta: [{ templateId: "satisfier:web_search", dAlpha: 2, dBeta: 0 }], gapsFiled: [], goalPathRecorded: true },
  routeArounds: [{ kind: "stall", missing_producer: ["web_search"], route_taken: "stop" }],
};

globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = String(input);
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
const { BlindRun, reportOf } = await import("../ui/src/components/Calibration");

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
    await new Promise((r) => setTimeout(r, 30));
  });
  return el;
}

const win = {
  window_id: "w1",
  sample_draw_id: "d1",
  seed: "s",
  label_sink: "report" as const,
  closes_at: Date.now() + 3_600_000,
  dispatch_ids: ["run-a", "run-b", "run-c"],
};

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

describe("BlindRun", () => {
  test("shows the goal and what the run produced", async () => {
    const el = await mount(React.createElement(BlindRun, { window: win, dispatchId: fixture.dispatchId, saved: null, onSaved: () => {} }));
    expect(el.textContent).toContain(fixture.goal.slice(0, 40));
    expect(el.querySelector("[aria-label='Outputs']")).not.toBeNull();
    expect(el.querySelectorAll("[aria-pressed]").length).toBe(3);
  });

  test("must-fail: nothing that carries the verdict is rendered", async () => {
    const el = await mount(React.createElement(BlindRun, { window: win, dispatchId: fixture.dispatchId, saved: null, onSaved: () => {} }));
    const text = el.textContent ?? "";
    expect(text).not.toContain(REASON); // reach reason, and the answer card that embeds it
    expect(text).not.toContain("Credit"); // credit section
    expect(text).not.toContain("+2α"); // credit badges
    expect(text).not.toContain("Stalls"); // route-arounds
    expect(text).not.toContain("Provenance"); // the trace holds the judge's lines
    expect(el.querySelector(".sf-verdict")).toBeNull(); // no state badge
    expect(el.querySelector("article.sf-run[data-state]")).toBeNull(); // the article carries no verdict
    expect(el.querySelector("[aria-label='Answer']")).toBeNull();
  });
});

describe("reportOf", () => {
  test("exports only graded runs of the sample, in sample order, with the window's identity", () => {
    const grades = {
      "run-c": { grade: "partial" as const, notes: "no chart", graded_at: "t2" },
      "run-a": { grade: "reached" as const, notes: "", graded_at: "t1" },
      "run-z": { grade: "reached" as const, notes: "", graded_at: "t3" },
    };
    const r = reportOf(win, grades, "now") as { window_id: string; sample_draw_id: string; grades: Array<{ dispatch_id: string }> };
    expect(r.window_id).toBe("w1");
    expect(r.sample_draw_id).toBe("d1");
    expect(r.grades.map((g) => g.dispatch_id)).toEqual(["run-a", "run-c"]);
  });
});
