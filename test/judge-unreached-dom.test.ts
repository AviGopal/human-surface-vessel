/**
 * A person's verdict that no producer took (a gateway's 502) says so in plain words, and what the
 * system itself said is one tap away under "why": the same as an ask the box could not send.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://surface.test/" });

import { afterAll, describe, expect, test } from "bun:test";
import { teardownDom, trackRoot } from "./setup.ts";
import { DEFAULT_VIEWS } from "../src/ui-views.ts";

const LINK = "ingress proxy failed: failed to connect via relay with status NO_RESERVATION";
const GAP = { input_refs: [], shape: "gap", claim: "The test is right: the source must change.", seq: 10, t: "2026-11-13T06:00:00.000Z", writer: "a detector", role: "detector", id: "gap-row-one" };
const PERSON = { userId: "key_person_1", name: null, email: null, expiresAt: Date.now() + 900_000 };
const writes: unknown[] = [];
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.endsWith("/api/session")) return Response.json({ keySignIn: true, signedIn: true, person: PERSON });
  if (url.includes("/api/discovery/resolve")) {
    const pointer = JSON.parse(String(init?.body)).pointer as Record<string, unknown>;
    if (pointer["type"] === "record_write") {
      writes.push(pointer["row"]);
      return Response.json({ error: LINK }, { status: 502 });
    }
    return Response.json(pointer["shape"] === "gap" ? [GAP] : []);
  }
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
const settle = async () => {
  for (let i = 0; i < 4; i++) await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
};
const held = DEFAULT_VIEWS.landing.entries.find((e) => e.title === "Checks held for you")!;

describe("a verdict nothing took", () => {
  test("must-fail: says it could not reach the system, with the system's words one tap away", async () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => {
      createRoot(el).render(React.createElement(QueryClientProvider, { client: qc }, React.createElement(Entries, { entries: [held] as never, enabled: true, intervalMs: 60_000, onOpenQuestion: () => {} })));
    });
    await settle();
    const wrong = [...el.querySelectorAll(`.sf-row[data-row="${GAP.id}"] button`)].find((b) => b.textContent === "Wrong") as HTMLButtonElement;
    await act(async () => wrong.click());
    await settle();
    expect(writes).toEqual([{ shape: "outcome", r: 0, input_refs: [GAP.id] }]);
    const alert = el.querySelector('[role="alert"]') as HTMLElement;
    expect(alert.querySelector("p")!.textContent).toBe("Not recorded: the system couldn't be reached.");
    // A refusal is said in the failure colour, not the grey of ordinary words.
    expect(alert.querySelector("p")!.hasAttribute("data-refused")).toBe(true);
    const why = alert.querySelector("details[data-said]") as HTMLDetailsElement;
    expect(why.querySelector("summary")!.textContent).toBe("why");
    expect(why.querySelector("p")!.textContent).toBe(LINK);
  });
});
