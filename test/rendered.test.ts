/**
 * <Rendered> in a DOM: the frame survives a renderer that throws, the three
 * densities draw one form, and only reading densities record a decision.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://surface.test/" });

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { teardownDom, trackRoot } from "./setup.ts";

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
const { createRoot: rawCreateRoot } = await import(from("react-dom/client"));
const createRoot = (...a: Parameters<typeof rawCreateRoot>) => trackRoot(rawCreateRoot(...a));
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
  await teardownDom();
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

describe("<Prose> pipe tables", () => {
  test("a GitHub pipe table renders as a table, cells keep inline formatting", async () => {
    const { Prose } = await import("../ui/src/components/Prose");
    const src = "**What was tried**\n\n| # | approach tried | outcome |\n|---|---|---|\n| 1 | `web_search` | not reached |\n| 2 | floor | stalled |";
    const el = await mount(React.createElement(Prose, { source: src }));
    const table = el.querySelector("table.sf-prose-table");
    expect(table).not.toBeNull();
    expect([...(table?.querySelectorAll("th") ?? [])].map((t) => t.textContent)).toEqual(["#", "approach tried", "outcome"]);
    expect(table?.querySelectorAll("tbody tr").length).toBe(2);
    expect(table?.querySelector("tbody td code")?.textContent).toBe("web_search");
    expect(el.textContent).not.toContain("|---|");
  });

  test("a table straight after a paragraph line is still a table", async () => {
    const { Prose } = await import("../ui/src/components/Prose");
    const el = await mount(React.createElement(Prose, { source: "Tried:\n| a | b |\n|---|---|\n| 1 | 2 |" }));
    expect(el.querySelector("table")).not.toBeNull();
    expect(el.querySelector("p")?.textContent).toBe("Tried:");
  });

  test("pipes without a separator row stay prose", async () => {
    const { Prose } = await import("../ui/src/components/Prose");
    const el = await mount(React.createElement(Prose, { source: "use a | b to pipe\nnot a table" }));
    expect(el.querySelector("table")).toBeNull();
  });
});
