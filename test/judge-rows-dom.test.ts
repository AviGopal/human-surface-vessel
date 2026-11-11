/**
 * A view entry with form "rows" draws each row with every field in full under its details, in the
 * order records returned them; with judge "outcome" each row offers a verdict. The verdict is an outcome row
 * citing exactly the judged row ({shape:"outcome", r, input_refs:[id]}, the form the walk's fold
 * counts), sent through the page's discovery path. Only the pointer is ever sent to the producer.
 *
 * Row: the form records answered with for the first answer the walk wrote (ids and text shortened).
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://surface.test/" });

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { teardownDom, trackRoot } from "./setup.ts";

const ANSWER = {
  input_refs: ["b32f0f17", "8b85c87c"],
  text: "Fix records-vessel so that a row claiming role=person must carry a verifiable attestation\nfrom a key that is not the node's own key.",
  shape: "answer",
  selection_ref: "3cfc4a0e",
  producer: "a-model",
  seq: 191,
  writer: "described-shape-vessel",
  role: "described",
  id: "01ca30b1",
};

let signedIn = true;
/** The surface restarted: it no longer holds the sign-in the page last read. */
let serverLost = false;
let sessionReads = 0;
let writeAnswer: Record<string, unknown> = { ok: true, seq: 205 };
const sent: Record<string, unknown>[] = [];
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.endsWith("/api/session")) {
    sessionReads++;
    if (serverLost) signedIn = false;
  }
  if (url.endsWith("/api/session")) return Response.json({ available: false, keySignIn: true, signedIn, ...(signedIn ? { person: { userId: "key_person_1", name: null, email: null, expiresAt: Date.now() + 900_000 } } : {}) });
  if (url.includes("/api/discovery/resolve")) {
    const pointer = JSON.parse(String(init?.body)).pointer as Record<string, unknown>;
    sent.push(pointer);
    if (pointer["type"] === "record_read") return Response.json([ANSWER]);
    if (pointer["type"] === "record_write") return signedIn && !serverLost ? Response.json(writeAnswer) : Response.json({ error: "sign_in_required", reason: "a write is sent only under the signed-in person's own key" }, { status: 401 });
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
  signedIn = true;
  serverLost = false;
  writeAnswer = { ok: true, seq: 205 };
  sent.length = 0;
});
const settle = async () => {
  for (let i = 0; i < 4; i++) await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
};
const ENTRY = { pointer: { type: "record_read", shape: "answer" }, form: "rows", judge: "outcome" };

async function mount(items: unknown[]): Promise<HTMLElement> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    createRoot(el).render(React.createElement(QueryClientProvider, { client: qc }, React.createElement(Entries, { entries: items as never, enabled: true, intervalMs: 60_000, onOpenQuestion: () => {} })));
  });
  await settle();
  return el;
}
const button = (el: HTMLElement, text: string) => [...el.querySelectorAll("button")].find((b) => b.textContent === text) as HTMLButtonElement;

describe("rows drawn in full, with a person's verdict", () => {
  test("must-fail: every field is in the row's details in full, text as written; only the pointer is sent", async () => {
    const el = await mount([ENTRY]);
    const row = el.querySelector('[data-row="01ca30b1"]')!;
    expect([...row.querySelectorAll("dt")].map((d) => d.textContent)).toEqual(["input refs", "text", "shape", "selection ref", "producer", "seq", "writer", "role", "id"]);
    expect(row.textContent).toContain(ANSWER.text);
    expect(row.textContent).toContain("b32f0f17, 8b85c87c");
    // The entry's pointer, and the owners' declarations of which fields are a row's words.
    expect(sent).toEqual(expect.arrayContaining([{ type: "record_read", shape: "answer" }, { type: "record_read", shape: "shape_description" }]));
    expect(sent.length).toBe(2);
  });

  test("must-fail: a verdict is an outcome row citing exactly the judged row", async () => {
    const el = await mount([ENTRY]);
    await act(async () => button(el, "Right").click());
    await settle();
    expect(sent.filter((p) => p["type"] === "record_write")).toEqual([{ type: "record_write", row: { shape: "outcome", r: 1, input_refs: ["01ca30b1"] } }]);
    expect(el.textContent).toContain("You judged this right (record #205)");
    await act(async () => button(el, "Wrong").click());
    await settle();
    expect(sent.filter((p) => p["type"] === "record_write").at(-1)).toEqual({ type: "record_write", row: { shape: "outcome", r: 0, input_refs: ["01ca30b1"] } });
  });

  test("must-fail: signed out, the verdict cannot be given and says how to sign in", async () => {
    signedIn = false;
    const el = await mount([ENTRY]);
    expect(button(el, "Right").disabled).toBe(true);
    expect(el.textContent).toContain("Sign in with your key to give a verdict.");
  });

  test("a refused write says why, and nothing claims it was recorded", async () => {
    writeAnswer = { error: "unauthorized", reason: "absent" };
    const el = await mount([ENTRY]);
    await act(async () => button(el, "Wrong").click());
    await settle();
    expect(el.textContent).toContain("Not recorded: unauthorized: absent");
    expect(el.textContent).not.toContain("You judged");
  });

  test("must-fail: a sign-in lost to a restart says so plainly and the page reads the session again", async () => {
    const el = await mount([ENTRY]);
    serverLost = true;
    const before = sessionReads;
    await act(async () => button(el, "Right").click());
    await settle();
    expect(el.textContent).toContain("Your verdict was not recorded: you are no longer signed in");
    expect(el.textContent).not.toContain("sign_in_required");
    expect(sessionReads).toBeGreaterThan(before);
    expect(button(el, "Right").disabled).toBe(true);
  });

  test("rows without judge offer no verdict", async () => {
    const el = await mount([{ pointer: { type: "record_read", shape: "answer" }, form: "rows" }]);
    expect(el.querySelector('[data-row="01ca30b1"]')).not.toBeNull();
    expect([...el.querySelectorAll("button")].length).toBe(0);
  });
});
