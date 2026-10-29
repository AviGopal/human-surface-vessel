/**
 * "brief": a decision brief ({asOf, items:[{questionId, subject, ask, whyYou, evidence[{label,value,source}],
 * options[{label,effect}]}]}) is drawn as one in a run's answer, and the census lists it under
 * content_forms.recent_briefs with the run it was drawn for. Recognised by structure, not by the shape name.
 * The briefs below are invented fixtures.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://surface.test/" });

import { afterAll, describe, expect, test } from "bun:test";
import { teardownDom, trackRoot } from "./setup.ts";
import { buildFormCensus } from "../src/form-census.ts";
import type { Observation } from "../src/store.ts";

const posted: Array<Record<string, unknown>> = [];
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  if (String(input).endsWith("/api/observations") && init?.method === "POST") {
    posted.push(JSON.parse(String(init.body)) as Record<string, unknown>);
    return new Response("{}", { status: 200 });
  }
  if (String(input).endsWith("/api/render-policy")) {
    return new Response(JSON.stringify({ tokenOverrides: {}, formByShape: {}, learnedFormByShape: {}, maxPreviewChars: null, ledgerDefaultExpanded: true, revision: 1, updatedAt: 0, note: null }), { status: 200 });
  }
  return new Response("{}", { status: 200 });
}) as typeof fetch;

const uiSrc = new URL("../ui/src/", import.meta.url).pathname;
const from = (spec: string): string => Bun.resolveSync(spec, uiSrc);
const React = await import(from("react"));
const { createRoot: rawCreateRoot } = await import(from("react-dom/client"));
const createRoot = (...a: Parameters<typeof rawCreateRoot>) => trackRoot(rawCreateRoot(...a));
const { act } = React;
const { QueryClient, QueryClientProvider } = await import(from("@tanstack/react-query"));
const { LiveControlsProvider } = await import("../ui/src/state/liveControls");
const { ContentRender } = await import("../ui/src/components/ContentRender");
const { Rendered } = await import("../ui/src/components/Rendered");
const { fromText } = await import("../ui/src/lib/content");
const { planContent } = await import("../ui/src/lib/ledger");
const { flushFormDecisions } = await import("../ui/src/lib/exposure-reporter");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function mount(node: unknown): Promise<HTMLElement> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    createRoot(el).render(React.createElement(QueryClientProvider, { client: qc }, React.createElement(LiveControlsProvider, null, node as never)));
  });
  await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
  return el;
}

afterAll(async () => {
  await teardownDom();
});

const BRIEF = {
  asOf: "2026-10-29T21:00:00Z",
  items: [
    {
      questionId: "q-fixture-1",
      subject: "Widget cache size",
      ask: "Raise the widget cache from 64 to 128 entries?",
      whyYou: "The record shows both settings reached; only you can weigh the memory cost.",
      evidence: [
        { label: "hit rate at 64", value: "71%", source: "trace exec_fixture_a" },
        { label: "hit rate at 128", value: "88%", source: "trace exec_fixture_b" },
      ],
      options: [
        { label: "Raise it", effect: "the cache holds 128 entries" },
        { label: "Keep 64", effect: "nothing changes" },
      ],
    },
  ],
};
const TEXT = JSON.stringify(BRIEF);

describe("decision brief form", () => {
  test("[MUST-FAIL] a brief of the frozen shape is planned as the brief form, under any shape name", () => {
    expect(planContent("decisionBrief", TEXT, false).form).toBe("brief");
    expect(planContent("some_other_shape", TEXT, false).form).toBe("brief");
    // Under one wrapper key it is the content.
    expect(planContent("x", JSON.stringify({ decisionBrief: BRIEF }), false).form).toBe("brief");
    // Snake_case aliases are read.
    const snake = { as_of: "t", items: [{ question_id: "q2", ask: "Pick one?", why_you: "w", evidence: [], options: [] }] };
    expect(planContent("x", JSON.stringify(snake), false).form).toBe("brief");
  });

  test("[MUST-FAIL] the brief draws subject, ask, why, evidence with its source, and option chips", async () => {
    const el = await mount(React.createElement(ContentRender, { plan: planContent("decisionBrief", TEXT, false) }));
    const item = el.querySelector('[data-question-id="q-fixture-1"]');
    expect(item).not.toBeNull();
    expect(item!.querySelector(".sf-brief-subject")?.textContent).toBe("Widget cache size");
    expect(item!.querySelector(".sf-brief-ask")?.textContent).toBe("Raise the widget cache from 64 to 128 entries?");
    expect(item!.querySelector(".sf-brief-why")?.textContent).toContain("only you can weigh");
    const rows = [...item!.querySelectorAll(".sf-brief-evidence-row")];
    expect(rows.length).toBe(2);
    expect(rows[0]!.textContent).toContain("71%");
    expect(rows[0]!.querySelector(".sf-brief-source")?.textContent).toBe("trace exec_fixture_a");
    const chips = [...item!.querySelectorAll(".sf-brief-option")];
    expect(chips.map((c) => c.textContent)).toEqual(["Raise it", "Keep 64"]);
    expect(chips[0]!.getAttribute("title")).toBe("the cache holds 128 entries");
  });

  test("[MUST-FAIL] a brief drawn in a run's answer is recorded with the run, and the census lists it in recent_briefs", async () => {
    posted.length = 0;
    await mount(React.createElement(Rendered, { content: fromText("decisionBrief", TEXT), density: "full", header: false, region: "run_answer", dispatchId: "disp-fixture-1" }));
    flushFormDecisions({ rendererBundle: null, presentationVariant: null });
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    const rows = posted.filter((p) => p["obs_type"] === "form_decision").flatMap((p) => (p["decisions"] as Array<Record<string, unknown>>) ?? []);
    const brief = rows.find((r) => r["form"] === "brief");
    expect(brief).toBeDefined();
    expect(brief!["region"]).toBe("run_answer");
    expect(brief!["dispatch_id"]).toBe("disp-fixture-1");
    // The census reads such a row back as a drawn brief, keyed by the run.
    const obs = { type: "form_decision", observedAt: 1_700_000_000_000, body: { decisions: [brief] } } as unknown as Observation;
    const census = buildFormCensus(() => [obs]);
    expect(census.recent_briefs).toEqual([{ dispatch_id: "disp-fixture-1", region: "run_answer", at: 1_700_000_000_000 }]);
  });

  test("CONTROL: an empty brief is a brief that says nothing needs the person", async () => {
    const empty = JSON.stringify({ asOf: "t", items: [] });
    const plan = planContent("decisionBrief", empty, false);
    expect(plan.form).toBe("brief");
    const el = await mount(React.createElement(ContentRender, { plan }));
    expect(el.querySelector('[data-brief="empty"]')?.textContent).toBe("Nothing needs you now.");
  });

  test("CONTROL: a partial or malformed brief is not a brief, is drawn as what it is, and nothing crashes", async () => {
    // An item missing its question id voids the brief: it plans as an ordinary record.
    const noId = JSON.stringify({ asOf: "t", items: [{ ask: "Pick one?" }] });
    expect(planContent("decisionBrief", noId, false).form).toBe("record");
    const noAsk = JSON.stringify({ asOf: "t", items: [{ questionId: "q" }] });
    expect(planContent("decisionBrief", noAsk, false).form).toBe("record");
    // A cut preview is never a whole brief.
    expect(planContent("decisionBrief", TEXT.slice(0, 80), true).form).not.toBe("brief");
    // Forced through the brief branch with content that is not one: a visible note and the text as received.
    const el = await mount(React.createElement(ContentRender, { plan: { form: "brief", text: noId, decidedBy: "brief" } }));
    expect(el.querySelector('[data-brief="invalid"]')).not.toBeNull();
    expect(el.textContent).toContain("Pick one?");
    const junk = await mount(React.createElement(ContentRender, { plan: { form: "brief", text: "not json {", decidedBy: "brief" } }));
    expect(junk.querySelector('[data-brief="invalid"]')).not.toBeNull();
  });

  test("CONTROL: existing forms plan as before, and a non-brief census lists no briefs", () => {
    expect(planContent("x", JSON.stringify({ a: 1, b: { c: 2 } }), false).form).toBe("record");
    expect(planContent("x", JSON.stringify({ items: [{ questionId: "q", ask: "a" }] }), false).form).toBe("record"); // no asOf: not a brief
    expect(planContent("x", "plain words", false).form).not.toBe("brief");
    const obs = { type: "form_decision", observedAt: 1, body: { decisions: [{ shape: "s", content_signature: "fnv1a32:00000001:1", form: "record", decided_by: "record", region: "run_answer" }] } } as unknown as Observation;
    expect(buildFormCensus(() => [obs]).recent_briefs).toEqual([]);
  });
});
