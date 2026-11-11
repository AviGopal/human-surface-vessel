/**
 * The page reads how often to look again from the render policy it polls (`recheck`), not from
 * a number of its own: the live default and each reader's floor follow the policy in force,
 * and the person's own interval pick still wins.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://surface.test/" });

import { afterAll, describe, expect, test } from "bun:test";
import { teardownDom, trackRoot } from "./setup.ts";

globalThis.fetch = (async () => Response.json({})) as typeof fetch;

const uiSrc = new URL("../ui/src/", import.meta.url).pathname;
const React = await import(Bun.resolveSync("react", uiSrc));
const { createRoot: rawCreateRoot } = await import(Bun.resolveSync("react-dom/client", uiSrc));
const createRoot = (...a: Parameters<typeof rawCreateRoot>) => trackRoot(rawCreateRoot(...a));
const { act } = React;
const { QueryClient, QueryClientProvider } = await import(Bun.resolveSync("@tanstack/react-query", uiSrc));
const { LiveControlsProvider, useLiveControls } = await import("../ui/src/state/liveControls");
const { useUiView } = await import("../ui/src/api/queries");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterAll(async () => {
  await teardownDom();
});

let pick: ((ms: number) => void) | null = null;
function Probe(): unknown {
  const { intervalMs, setIntervalMs } = useLiveControls();
  pick = setIntervalMs;
  useUiView("landing", { enabled: true, intervalMs });
  return React.createElement("p", { "data-live": String(intervalMs) });
}

async function mount(recheck: Record<string, number> | null) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (recheck) qc.setQueryData(["renderPolicy"], { tokenOverrides: {}, formByShape: {}, maxPreviewChars: null, ledgerDefaultExpanded: true, revision: 3, updatedAt: 0, note: null, recheck });
  await act(async () => {
    createRoot(el).render(React.createElement(QueryClientProvider, { client: qc }, React.createElement(LiveControlsProvider, null, React.createElement(Probe))));
  });
  const live = () => Number(el.querySelector("[data-live]")!.getAttribute("data-live"));
  const viewFloor = () => qc.getQueryCache().find({ queryKey: ["uiView", "landing"] })!.observers[0]!.options.refetchInterval;
  return { live, viewFloor };
}

describe("the page reads recheck from the policy in force", () => {
  test("must-fail: the live default and a reader's floor are the policy's, not the bootstrap's", async () => {
    const page = await mount({ liveMs: 9000, viewMinMs: 12000 });
    expect(page.live()).toBe(9000);
    expect(page.viewFloor()).toBe(12000);
  });

  test("with no policy yet, the bootstrap defaults hold", async () => {
    const page = await mount(null);
    expect(page.live()).toBe(2000);
    expect(page.viewFloor()).toBe(5000);
  });

  test("must-fail: the person's own pick wins over the policy's live cadence", async () => {
    const page = await mount({ liveMs: 9000, viewMinMs: 1000 });
    await act(async () => pick!(1500));
    expect(page.live()).toBe(1500);
    expect(page.viewFloor()).toBe(1500);
  });
});
