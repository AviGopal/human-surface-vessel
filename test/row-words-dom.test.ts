/**
 * A row reads as words, its record folded (surface-acts-on-shapes-present R.2). The words are
 * the fields declared for the row's shape: the owner's `shape_description` row, else the view
 * entry's `words`; with neither, the row shows its shape and time. Every other field is under
 * the row's "details". The surface names no field and guesses none.
 *
 * Shapes: one node 11-11. "What people asked" drew each ask as seven labelled fields (input refs,
 * shape, what, seq, t, writer key, a 64-hex id), and "What the walk answered" as a column of hashes.
 * Rows: the live forms, ids shortened where the test does not need the length.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://surface.test/" });

import { afterAll, describe, expect, test } from "bun:test";
import { teardownDom, trackRoot } from "./setup.ts";
import { DEFAULT_VIEWS } from "../src/ui-views.ts";

const HEX = "469ce13290f5fa721b32f13bb4415a3ebdd75989a7a1c33120f0cdeb42812d07";
const ASK = { input_refs: [], shape: "world_changed", what: "Close any known gap by changing the code.", seq: 5300, t: "2026-11-11T11:55:14.411Z", writer: "key_person_1", role: "person", id: HEX };
const ANSWER = { input_refs: [HEX], text: "The code has been modified to address previously identified gaps.", shape: "answer", selection_ref: "3772dcb0" + HEX.slice(8), call_id: "d971d781-a504-4cbf-9fbf-e24d8d957b20", producer: "a-model", seq: 5304, t: "2026-11-11T11:55:16.186Z", writer: "described-shape-vessel", role: "described", id: "0e83964e" + HEX.slice(8) };
const OUTCOME = { input_refs: [HEX], event_ref: HEX, r: 1, evidence_refs: [HEX], cell: null, shape: "outcome", seq: 5296, t: "2026-11-11T11:42:15.429Z", writer: "key_person_1", role: "person", id: "15dd0c3a" + HEX.slice(8) };
const FAILURE = { input_refs: [HEX], shape: "failure", kind: "skip", body: `template ${HEX} cannot run: wait-for, produce, run`, seq: 5332, t: "2026-11-11T11:55:17.327Z", writer: "walk-vessel", role: "walk", id: "6a5ccf1f" + HEX.slice(8) };
const BY_SHAPE: Record<string, unknown[]> = { world_changed: [ASK], answer: [ANSWER], outcome: [OUTCOME], failure: [FAILURE] };

/** The owners' declarations records answers with; a test replaces it between draws. */
let declarations: unknown[] = [];
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.endsWith("/api/session")) return Response.json({ available: false, keySignIn: true, signedIn: false });
  if (url.includes("/api/discovery/resolve")) {
    const pointer = JSON.parse(String(init?.body)).pointer as Record<string, unknown>;
    if (pointer["type"] === "record_read" && pointer["shape"] === "shape_description") return Response.json(declarations);
    if (pointer["type"] === "record_read") return Response.json(BY_SHAPE[String(pointer["shape"])] ?? []);
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

let qc: InstanceType<typeof QueryClient>;
async function mount(entries: unknown[]): Promise<HTMLElement> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    createRoot(el).render(React.createElement(QueryClientProvider, { client: qc }, React.createElement(Entries, { entries: entries as never, enabled: true, intervalMs: 60_000, onOpenQuestion: () => {} })));
  });
  await settle();
  return el;
}
/** What a row shows with its details closed: everything in it but the fold's body. */
function inView(row: Element): string {
  const copy = row.cloneNode(true) as Element;
  copy.querySelectorAll("details > :not(summary)").forEach((n) => n.remove());
  return copy.textContent ?? "";
}
const row = (el: HTMLElement, shape: string): Element => el.querySelector(`[data-report="record_read"] .sf-row[data-row="${String((BY_SHAPE[shape]![0] as { id: string }).id)}"]`)!;
const landing = DEFAULT_VIEWS.landing.entries.filter((e) => e.form === "rows");

describe("a row reads as words, its record folded", () => {
  test("must-fail: on the default landing an ask, an answer and an outcome each show their words, with no id, hash, key or field label in view", async () => {
    declarations = [];
    const el = await mount(landing);
    const ask = row(el, "world_changed");
    expect(ask.querySelector(".sf-row-words")!.textContent).toBe(ASK.what);
    expect(row(el, "answer").querySelector(".sf-row-words")!.textContent).toBe(ANSWER.text);
    expect(row(el, "outcome").querySelector(".sf-row-words")!.textContent).toBe("r 1");
    for (const shape of ["world_changed", "answer", "outcome", "failure"]) {
      const shown = inView(row(el, shape));
      expect(shown).not.toMatch(/[0-9a-f]{64}/);
      expect(shown).not.toContain("key_");
      expect(shown).not.toMatch(/input refs|selection ref|seq\b/);
    }
  });

  test("must-fail: a row whose shape declares no words shows its shape and time only", async () => {
    declarations = [];
    const el = await mount(landing);
    const failure = row(el, "failure");
    expect(failure.querySelector(".sf-row-words")!.textContent).toBe("failure");
    expect(failure.querySelector(".sf-row-time")).not.toBeNull();
    // The time names its zone on hover, so a person can line it up with times written in UTC elsewhere.
    expect(failure.querySelector(".sf-row-time")!.getAttribute("title")).toMatch(/(\d:\d\d|[AP]M) (UTC|GMT([+-]\d{1,2}(:\d\d)?)?|[A-Z]{3,5})$/);
    expect(inView(failure)).not.toContain("cannot run");
  });

  test("must-fail: opening details shows every field in full; the verdict stays outside the fold", async () => {
    declarations = [];
    const el = await mount(landing);
    const answer = row(el, "answer");
    const details = answer.querySelector("details.sf-row-details")!;
    expect(details.querySelector("summary")!.textContent).toBe("details");
    expect([...details.querySelectorAll("dt")].map((d) => d.textContent)).toEqual(["input refs", "text", "shape", "selection ref", "call id", "producer", "seq", "t", "writer", "role", "id"]);
    expect(details.textContent).toContain(HEX);
    const judge = answer.querySelector(".sf-row-judge")!;
    expect(judge).not.toBeNull();
    expect(details.contains(judge)).toBe(false);
  });

  test("must-fail: the owner's declaration comes before the entry's, and a later one moves what is shown with no rebuild", async () => {
    declarations = [{ shape: "shape_description", of: "answer", words: ["producer", "text"], role: "owner", seq: 1 }];
    const el = await mount(landing);
    expect([...row(el, "answer").querySelectorAll(".sf-row-words")].map((p) => p.textContent)).toEqual(["a-model", ANSWER.text]);
    // A later row is the state: the owner withdraws the declaration, and the entry's words apply again.
    declarations = [...declarations, { shape: "shape_description", of: "answer", description: "prose only", role: "owner", seq: 2 }];
    // The page's next read on its cadence, with nothing rebuilt or remounted.
    await act(async () => { await qc.refetchQueries(); });
    await settle();
    expect([...row(el, "answer").querySelectorAll(".sf-row-words")].map((p) => p.textContent)).toEqual([ANSWER.text]);
  });

  test("an owner's declaration with no valid field list declares nothing", async () => {
    // Accepted as far as it is valid, this list would put the row's id in view.
    declarations = [{ shape: "shape_description", of: "world_changed", words: ["id", "bad field"] }];
    const el = await mount(landing);
    expect(row(el, "world_changed").querySelector(".sf-row-words")!.textContent).toBe(ASK.what);
  });
});
