/**
 * Signed out, the surface sends no lookup (src/routes/proxy.ts answers 401 `sign_in_required`), so
 * every entry is refused for want of a sign-in. Each says so in a person's words on its title's
 * line, "sign in to see", and draws nothing under it: not the refusal's own words, and no line of
 * its own per entry. Any other refusal still says it drew no answer, in the producer's words.
 *
 * Shape: one node 11-12. Signed out, every card on the landing read "no answer: sign_in_required:
 * a lookup is sent only under the caller's own key: sign in".
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://surface.test/" });

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { teardownDom, trackRoot } from "./setup.ts";
import { DEFAULT_VIEWS } from "../src/ui-views.ts";

/** The live refusal, as proxy.ts sends it with no one signed in. */
const SIGN_IN = () => Response.json({ error: "sign_in_required", reason: "a lookup is sent only under the caller's own key: sign in" }, { status: 401 });
let answer: () => Response = SIGN_IN;
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = String(input);
  if (url.endsWith("/api/session")) return Response.json({ keySignIn: true, signedIn: false });
  if (url.includes("/api/discovery/resolve")) return answer();
  return Response.json({});
}) as typeof fetch;

const uiSrc = new URL("../ui/src/", import.meta.url).pathname;
const React = await import(Bun.resolveSync("react", uiSrc));
const { createRoot: rawCreateRoot } = await import(Bun.resolveSync("react-dom/client", uiSrc));
const createRoot = (...a: Parameters<typeof rawCreateRoot>) => trackRoot(rawCreateRoot(...a));
const { act } = React;
const { QueryClient, QueryClientProvider } = await import(Bun.resolveSync("@tanstack/react-query", uiSrc));
const { Entries } = await import("../ui/src/components/Reports");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterAll(async () => {
  await teardownDom();
});
beforeEach(() => {
  document.body.replaceChildren();
  answer = SIGN_IN;
});
const settle = async () => {
  for (let i = 0; i < 4; i++) await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
};

async function mount(entries: readonly unknown[]): Promise<HTMLElement> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    createRoot(el).render(React.createElement(QueryClientProvider, { client: qc }, React.createElement(Entries, { entries, enabled: true, intervalMs: 60_000, onOpenQuestion: () => {} })));
  });
  await settle();
  return el;
}
const LANDING = DEFAULT_VIEWS.landing.entries;
const cards = (el: HTMLElement) => [...el.querySelectorAll(".sf-reports > .sf-report")];

describe("a read refused for want of a sign-in", () => {
  test("must-fail: every entry says sign in to see on its title's line, and none shows the refusal's words", async () => {
    const el = await mount(LANDING);
    expect(cards(el).length).toBe(LANDING.length);
    for (const card of cards(el)) {
      const title = card.querySelector(".sf-report-title")!;
      expect(title.querySelector("[data-sign-in-to-see]")?.textContent).toBe("sign in to see");
    }
    expect(el.textContent).not.toContain("sign_in_required");
    expect(el.textContent).not.toContain("no answer");
  });

  test("must-fail: a refused entry draws nothing under its title", async () => {
    const el = await mount(LANDING);
    for (const card of cards(el)) {
      expect(card.querySelector(".sf-report-note")).toBeNull();
    }
  });

  test("control: any other refusal still says it drew no answer, in the producer's words", async () => {
    answer = () => Response.json({ error: "no producer for record_read" }, { status: 502 });
    const el = await mount(LANDING);
    expect(el.querySelector("[data-sign-in-to-see]")).toBeNull();
    expect(el.textContent).toContain("no answer: no producer for record_read");
  });
});
