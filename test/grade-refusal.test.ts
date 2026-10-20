/**
 * A verdict the trace store refuses for want of the "verdict:human" scope is
 * said plainly, with the server's words folded; any other refusal is shown as
 * sent. And a long float in a field chip reads rounded.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://surface.test/" });

import { afterAll, describe, expect, test } from "bun:test";
import { teardownDom, trackRoot } from "./setup.ts";

const REFUSED = "activity-api 403: a human verdict requires a credential with the verdict:human scope";
let errorText = REFUSED;
globalThis.fetch = (async (input: RequestInfo | URL) => {
  if (String(input).includes("/api/grade")) return new Response(JSON.stringify({ error: errorText }), { status: 403 });
  return new Response("{}", { status: 200 });
}) as typeof fetch;

const uiSrc = new URL("../ui/src/", import.meta.url).pathname;
const from = (spec: string): string => Bun.resolveSync(spec, uiSrc);
const React = await import(from("react"));
const { createRoot: rawCreateRoot } = await import(from("react-dom/client"));
const createRoot = (...a: Parameters<typeof rawCreateRoot>) => trackRoot(rawCreateRoot(...a));
const { act } = React;
const { QueryClient, QueryClientProvider } = await import(from("@tanstack/react-query"));
const { GradeGesture } = await import("../ui/src/components/GradeGesture");
const { gradeRefusal } = await import("../ui/src/lib/refusal");
const { planContent } = await import("../ui/src/lib/ledger");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const settle = async (): Promise<void> => {
  for (let i = 0; i < 3; i++) await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
};

async function submitAndRead(): Promise<HTMLElement> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  await act(async () => {
    createRoot(el).render(
      React.createElement(QueryClientProvider, { client: qc },
        React.createElement(GradeGesture, { renderedState: "ungraded", executionId: "e1", goal: "g", alreadyGraded: false, humanReachNotes: null })),
    );
  });
  const reached = [...el.querySelectorAll("button, label")].find((b) => b.textContent?.trim() === "Reached") as HTMLElement | undefined;
  expect(reached).toBeDefined();
  await act(async () => { reached!.click(); });
  const form = el.querySelector("form")!;
  await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  await settle();
  return el;
}

afterAll(async () => {
  await teardownDom();
});

describe("a refused verdict", () => {
  test("must-fail: the scope refusal reads plainly, once, with the server's words folded", async () => {
    errorText = REFUSED;
    const el = await submitAndRead();
    const status = el.querySelector(".sf-ix-status")?.textContent ?? "";
    expect(status).toContain("this surface's credential can't record a human verdict");
    expect(status).not.toContain("activity-api 403");
    expect(status).not.toContain("Not delivered");
    const folded = el.querySelector("details.sf-grade-refusal");
    expect(folded).not.toBeNull();
    expect(folded?.textContent).toContain(REFUSED);
  });

  test("any other refusal is shown as the server sent it, with nothing folded", async () => {
    errorText = "trace store unreachable";
    const el = await submitAndRead();
    expect(el.querySelector(".sf-ix-status")?.textContent).toContain("Not recorded: trace store unreachable");
    expect(el.querySelector("details.sf-grade-refusal")).toBeNull();
  });

  test("only the named scope is paraphrased", () => {
    expect(gradeRefusal(REFUSED)).not.toBeNull();
    expect(gradeRefusal("HTTP 403")).toBeNull();
    expect(gradeRefusal(null)).toBeNull();
  });
});

describe("field chips", () => {
  test("must-fail: a long float reads rounded; integers and short floats are untouched", () => {
    const body = { text: "A paragraph of answer text. ".repeat(20), cost_usd: 0.0017771999999999998, tokens: 1234, ratio: 0.5 };
    const plan = planContent("llmResponse", JSON.stringify(body), false);
    const chips = (plan.meta ?? []).filter((m) => m.kind === "field") as { key: string; text: string }[];
    const byKey = Object.fromEntries(chips.map((c) => [c.key, c.text]));
    expect(byKey["cost_usd"]).toBe("0.001777");
    expect(byKey["tokens"]).toBe("1234");
    expect(byKey["ratio"]).toBe("0.5");
  });
});
