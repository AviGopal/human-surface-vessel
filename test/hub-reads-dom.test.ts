/**
 * A read answered by a vessel on another node comes back through the federation transport as
 * `{shape, produced_by, body | value, note}` inside discovery's content. Its rows are drawn as rows.
 * A refusal the transport passed on as a success (records' `{failure: {status, body}}`) is said as
 * "Not read" in a failure's colour, and counted nowhere. An answer that is not rows is never drawn
 * as one row: the entry says so, with the answer under details, and a folded entry counts nothing.
 *
 * Shape: one hub 11-14. Signed in, every records read on the landing drew one row titled
 * "record read" (the transport's answer), and the folded cards said "1 in all".
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://surface.test/" });

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { teardownDom, trackRoot } from "./setup.ts";

const ASK = { input_refs: [], shape: "world_changed", what: "What is happening?", seq: 10, t: "2026-11-14T00:30:00.000Z", writer: "a person", role: "person", id: "a".repeat(64) };
const viaHub = (answer: unknown) => ({ content: { shape: "record_read", produced_by: "records-vessel@a-node", body: answer, note: "proxied to the owning vessel on the peer substrate over libp2p" } });
let ANSWER: unknown = viaHub([ASK]);

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.endsWith("/api/session")) return Response.json({ keySignIn: true, signedIn: true, person: { userId: "key_person_1", name: null, email: null, expiresAt: Date.now() + 900_000 } });
  if (url.includes("/api/discovery/resolve")) {
    const pointer = JSON.parse(String(init?.body)).pointer as Record<string, unknown>;
    return Response.json(pointer["shape"] === "world_changed" ? ANSWER : []);
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
beforeEach(() => {
  document.body.replaceChildren();
});
const settle = async () => {
  for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
};
async function mount(entry: unknown): Promise<HTMLElement> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    createRoot(el).render(React.createElement(QueryClientProvider, { client: qc }, React.createElement(Entries, { entries: [entry] as never, enabled: true, intervalMs: 60_000, onOpenQuestion: () => {} })));
  });
  await settle();
  return el;
}
const asks = { pointer: { type: "record_read", shape: "world_changed" }, form: "rows", title: "What people asked", words: ["what"] };
const folded = { ...asks, title: "Asks", folded: true, strip: { hours: 24 } };
const REFUSED = { failure: { status: 403, body: "a read is refused here" } };

describe("a read answered through the hub", () => {
  test("must-fail: the rows inside the transport's answer are drawn as rows", async () => {
    ANSWER = viaHub([ASK]);
    const el = await mount(asks);
    expect(el.querySelectorAll(`.sf-row[data-row="${ASK.id}"]`).length).toBe(1);
    expect(el.textContent).toContain("What is happening?");
    expect(el.textContent).not.toContain("record read");
  });

  test("must-fail: a refusal passed on as a success is said as not read, in a failure's colour, and not counted", async () => {
    for (const answer of [REFUSED, viaHub(REFUSED)]) {
      ANSWER = answer;
      document.body.replaceChildren();
      const open = await mount(asks);
      expect(open.querySelector("[data-refused]")!.textContent).toBe("Not read: a read is refused here");
      expect(open.querySelector(".sf-row")).toBeNull();
      document.body.replaceChildren();
      const fold = await mount(folded);
      expect(fold.querySelector("summary [data-refused]")!.textContent).toBe("not read");
      expect(fold.querySelector("[data-count]")).toBeNull();
    }
  });

  test("must-fail: an answer that is not rows draws no row and is not counted", async () => {
    ANSWER = { content: { shape: "record_read", x: 1 } };
    const el = await mount(asks);
    expect(el.querySelector(".sf-row")).toBeNull();
    expect(el.textContent).toContain("answered with something that is not rows");
    expect(el.querySelector("details[data-not-rows]")).not.toBeNull();
    document.body.replaceChildren();
    const fold = await mount(folded);
    expect(fold.querySelector("[data-count]")).toBeNull();
    expect(fold.textContent).not.toContain("1 in all");
  });

  test("control: rows answered directly are drawn as before", async () => {
    ANSWER = [ASK];
    const el = await mount(asks);
    expect(el.querySelectorAll(".sf-row").length).toBe(1);
  });
});
