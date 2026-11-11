/**
 * A row a person wrote, read by a viewer who has not signed in, names "a person" as its writer,
 * not the person's key id: the surface's read route unnames it before the answer leaves the
 * server, so the page cannot draw it and the browser never receives it. Signed in, only the
 * person's own rows name them (test/person-writer-unnamed.test.ts, at the route). Through the real
 * route, mounted in the page as the browser calls it.
 *
 * Shape: one node 11-11. On the live landing, opening "details" under a person's ask showed
 * "writer key_…" to a viewer who was not signed in.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://surface.test/" });

import { afterAll, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { teardownDom, testAuth, trackRoot } from "./setup.ts";
import { proxyRouter } from "../src/routes/proxy.ts";
import { DISCOVERY_ENDPOINT, PORT } from "../src/config.ts";

const KEY_ID = "key__test-person";
const ASK = { input_refs: [], shape: "world_changed", what: "Find the most interesting thing on the internet today.", seq: 9510, t: "2026-11-11T16:34:47.891Z", writer: KEY_ID, role: "person", id: "b".repeat(64) };
const ANSWER = { input_refs: [ASK.id], shape: "answer", text: "Here it is.", seq: 9520, t: "2026-11-11T16:40:00.000Z", writer: "described-shape-vessel", role: "described", id: "c".repeat(64) };

const app = new Hono();
app.route("/", proxyRouter);
const own = `http://127.0.0.1:${PORT + 10_000}`;

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  // records, through discovery: the rows as records serves them, envelope and all.
  if (url.startsWith(DISCOVERY_ENDPOINT.replace(/\/+$/, ""))) return new Response(JSON.stringify({ resolved: true, shape: "record_read", body: [ASK, ANSWER] }), { status: 200, headers: { "Content-Type": "application/json" } });
  // The page's own calls go to the real route.
  if (url.includes("/api/discovery/resolve")) {
    const r = await app.request(`${own}/api/discovery/resolve`, { method: "POST", body: String(init?.body), headers: { "Content-Type": "application/json", ...testAuth() } });
    return new Response(await r.text(), { status: r.status, headers: { "Content-Type": "application/json" } });
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
  for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
};
const asks = { pointer: { type: "record_read", shape: "world_changed" }, form: "rows", title: "What people asked", words: ["what"] };
async function mount(): Promise<HTMLElement> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    createRoot(el).render(React.createElement(QueryClientProvider, { client: qc }, React.createElement(Entries, { entries: [asks] as never, enabled: true, intervalMs: 60_000, onOpenQuestion: () => {} })));
  });
  await settle();
  return el;
}
const details = (el: HTMLElement, id: string): HTMLDetailsElement => el.querySelector(`.sf-row[data-row="${id}"] details.sf-row-details`) as HTMLDetailsElement;

describe("a person's row, read by a viewer who has not signed in", () => {
  test("must-fail: its opened details name no key id, only that a person wrote it", async () => {
    const el = await mount();
    const d = details(el, ASK.id);
    d.open = true;
    expect(el.textContent).not.toContain(KEY_ID);
    const writer = [...d.querySelectorAll(".sf-row-field")].find((f) => f.querySelector("dt")!.textContent === "writer")!;
    expect(writer.querySelector("dd")!.textContent).toBe("a person");
    // The rest of the row is as records wrote it.
    expect(d.textContent).toContain(ASK.what);
    expect(d.textContent).toContain("person");
  });
});
