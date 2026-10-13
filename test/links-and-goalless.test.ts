/**
 * A run that stopped at search leads with the links it found; a run with no
 * goal text folds under one line in the rail. Shapes: 24 h of node1 runs
 * (10-13): 31 surface asks ended "only links" (ef6e8a43, a windspeed ask), and
 * 151 runs had no goal at all (template extraction, empty dispatches).
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://surface.test/" });

import { afterAll, describe, expect, test } from "bun:test";
import type { GoalWalkState } from "../ui/src/api/types";

const SEARCH = JSON.stringify({
  shape: "webSearchResult",
  query: "highest windspeed right now",
  results: [
    { title: "Live Wind Gust Map — Peak Gusts Right Now", url: "https://liveearthviewer.com/weather/gusts", snippet: "Peak wind gusts — the strongest measured..." },
    { title: "Wind map", url: "https://www.windy.com/", snippet: "Live wind" },
    { title: "Cut entry", url: "https://cut.example/p" },
  ],
});
// The preview a run carries is cut: the last entry arrives half-written.
const PREVIEW = SEARCH.slice(0, SEARCH.indexOf("https://cut.example") + 12);

let dispatches: unknown[] = [];
globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
  const ask = JSON.parse(String(init?.body ?? "{}")) as { type?: string };
  if (String(_input).includes("/api/questions")) return new Response(JSON.stringify({ resolved: true, success: true, body: { questions: [] } }), { status: 200 });
  if (ask.type === "activeDispatches") return new Response(JSON.stringify({ resolved: true, shape: "activeDispatches", body: { dispatches } }), { status: 200 });
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
const { Chain } = await import("../ui/src/components/Chain");
const { RunsList } = await import("../ui/src/components/RunsList");
const { linksIn } = await import("../ui/src/lib/links");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function mount(node: unknown): Promise<HTMLElement> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    createRoot(el).render(React.createElement(QueryClientProvider, { client: qc }, React.createElement(LiveControlsProvider, null, React.createElement(QuestionsProvider, null, node as never))));
  });
  for (let i = 0; i < 3; i++) await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
  return el;
}

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

const walk = (reached: boolean | null): GoalWalkState =>
  ({
    dispatchId: "d", status: "completed", reached, goalReachReason: "only links", poolShapes: [], pendingTargets: [], poolEvents: [], walkLog: [],
    currentStep: null, steps: [], executionPath: null, walkTier: null, attemptCount: null, grounded: null, learning: null, answerBody: null,
    operator: null, completionShapes: null, humanGraded: false, humanReachNotes: null, trigger: null, requeueOf: null,
    poolProvenance: [
      { id: "g", shape: "goal", producedBy: "seed", contentPreview: "{\"goal\":\"Where is the highest windspeed right now?\"}", chars: 52, consumedIds: [] },
      { id: "s", shape: "webSearchResult", producedBy: "satisfier:webSearchResult", contentPreview: PREVIEW, chars: SEARCH.length, consumedIds: ["g"] },
    ],
  }) as unknown as GoalWalkState;

describe("found links", () => {
  test("only whole entries count: a half-received url is not a link", () => {
    expect(linksIn(PREVIEW).map((l) => l.url)).toEqual(["https://liveearthviewer.com/weather/gusts", "https://www.windy.com/"]);
  });

  test("must-fail: a run that did not reach leads with the links it found", async () => {
    const el = await mount(React.createElement(Chain, { walk: walk(false) }));
    const section = el.querySelector("[aria-label='Links']");
    expect(section).not.toBeNull();
    const anchors = [...section!.querySelectorAll("a")];
    expect(anchors.map((a) => a.getAttribute("href"))).toEqual(["https://liveearthviewer.com/weather/gusts", "https://www.windy.com/"]);
    expect(anchors[0]?.textContent).toContain("Live Wind Gust Map");
    expect(anchors[0]?.getAttribute("rel")).toContain("noopener");
    // First in the outputs, after only what the run's records declare failed.
    const outputs = el.querySelector("[aria-label='Outputs']")!;
    const first = [...outputs.children].find((e) => ["SECTION", "DETAILS", "ARTICLE", "UL"].includes(e.tagName) && !e.classList.contains("sf-chain-failed"));
    expect(first?.className).toBe("sf-chain-links");
  });

  test("a run that reached shows its outputs as they are, with no links block", async () => {
    const el = await mount(React.createElement(Chain, { walk: walk(true) }));
    expect(el.querySelector("[aria-label='Links']")).toBeNull();
  });
});

describe("goal-less runs", () => {
  const at = (m: number): string => new Date(Date.UTC(2026, 9, 13, 10, m)).toISOString();
  test("must-fail: runs with no goal fold under one line; runs with a goal stay in the list", async () => {
    dispatches = [
      { dispatchId: "a", goal: "Check the networking status", operator: "rhythm-conductor-drain", status: "completed", reached: true, startedAt: at(1) },
      { dispatchId: "b", goal: null, operator: null, trigger: "run-goal", status: "completed", reached: false, startedAt: at(2) },
      { dispatchId: "c", goal: "  ", operator: null, trigger: "run-goal", status: "completed", reached: false, startedAt: at(3) },
    ];
    const el = await mount(React.createElement(RunsList, { selectedDispatchId: null, onSelect: () => {}, filter: "system" }));
    const fold = el.querySelector("details.sf-run-goalless");
    expect(fold).not.toBeNull();
    expect(fold?.querySelector("summary")?.textContent).toBe("No goal · 2");
    expect(fold?.hasAttribute("open")).toBe(false);
    const outside = [...el.querySelectorAll(".sf-run-row")].filter((r) => !fold!.contains(r)).map((r) => r.getAttribute("data-dispatch-id"));
    expect(outside).toEqual(["a"]);
  });

  test("the fold opens when the selected run is in it", async () => {
    const el = await mount(React.createElement(RunsList, { selectedDispatchId: "b", onSelect: () => {}, filter: "system" }));
    expect(el.querySelector("details.sf-run-goalless")?.hasAttribute("open")).toBe(true);
  });
});
