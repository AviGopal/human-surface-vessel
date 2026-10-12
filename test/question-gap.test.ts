/**
 * A gap question's card shows the gap's own summary and edit site in place of
 * the writer's 300-character cut, once the gap is read; unread, the body as
 * written.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://surface.test/" });

import { afterAll, beforeEach, describe, expect, test } from "bun:test";

const CUT = "In repos/development-vessel/src/resolvers/feature-compose.ts, add a FABRICATE";
const FULL = `${CUT}-TO-SATISFY lens to the adversarial refuters. Apply exactly these 2 edits.`;
const question = {
  id: "pending-verify-route-edit-e8797240",
  revision: 1,
  title: "Gap landed but is unverified — did the change actually fix it?",
  body: `Gap route-edit-e8797240 (edit_intent_route) had a single substrate-authored landing. Please confirm: did the landed change actually fix this? Summary: ${CUT}`,
  createdAt: 0,
  updatedAt: 0,
  responses: [],
  answered: false,
  declined: false,
  kind: "gap_pending_verification",
};
let gap: Record<string, unknown> | null = null;

globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = String(input);
  if (url.includes("/api/questions")) {
    return new Response(JSON.stringify({ resolved: true, success: true, body: { questions: [question] } }), { status: 200 });
  }
  if (url.includes("/api/gaps/")) {
    return gap
      ? new Response(JSON.stringify({ gap }), { status: 200 })
      : new Response(JSON.stringify({ error: "store unreachable" }), { status: 502 });
  }
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
const { QuestionView } = await import("../ui/src/components/QuestionView");

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
        React.createElement(LiveControlsProvider, null, React.createElement(QuestionsProvider, null, React.createElement(QuestionView, { questionId: question.id }))),
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

beforeEach(() => {
  gap = null;
});

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

describe("a gap question's card", () => {
  test("shows the gap's full summary and edit site, not the cut", async () => {
    gap = {
      id: "route-edit-e8797240",
      summary: FULL,
      classification_metadata: { edit_site: "repos/development-vessel/src/resolvers/feature-compose.ts" },
    };
    const el = await mount();
    const text = el.textContent ?? "";
    expect(text).toContain("Apply exactly these 2 edits.");
    expect(el.querySelector("[aria-label='Gap'] .sf-mono")?.textContent).toBe("repos/development-vessel/src/resolvers/feature-compose.ts");
    expect(text).toContain("Please confirm");
    expect(text).not.toContain("Summary:");
  });

  test("must-fail: an unread gap leaves the body as written", async () => {
    const el = await mount();
    const text = el.textContent ?? "";
    expect(text).toContain(`Summary: ${CUT}`);
    expect(el.querySelector("[aria-label='Gap']")).toBeNull();
  });
});
