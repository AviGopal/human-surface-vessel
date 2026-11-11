/**
 * A row's opened details draw each value by what it is, not as raw text: an instant in the reader's
 * zone with the exact value on hover; an id as a short mark whose text is still the whole id
 * (selecting it copies it; the style clips it, measured in the rendered check); several ids as
 * their count, folded over their marks; an empty list as "none". Anything else is its text, so details still holds every field in full.
 *
 * Shape: one node 11-11. Opening "details" under an ask showed "2026-11-11T16:34:47.891Z", a
 * 64-character id and an empty "input refs" as they are stored; a walk's answer listed 112 ids,
 * 2490 px of hex on a desk and 7148 px on a phone.
 */
process.env.TZ = "UTC";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://surface.test/" });

import { afterAll, describe, expect, test } from "bun:test";
import { teardownDom, trackRoot } from "./setup.ts";

const ID = "b".repeat(64);
const REFS = ["c", "d", "e", "f", "a"].map((c) => c.repeat(64));
const ROW = { input_refs: [], shape: "world_changed", what: "Find the most interesting thing.", seq: 9510, t: "2026-11-11T16:34:47.891Z", writer: "a person", role: "person", id: ID };
const ONE = { input_refs: [ID], shape: "outcome", r: 1, seq: 9530, t: "2026-11-11T16:41:00.000Z", writer: "a person", role: "person", id: "8".repeat(64) };
const CALL = "0be3a2f5-291b-4ef9-bacd-9e83e318c8e1";
const REPLY = { input_refs: REFS, call_id: CALL, shape: "answer", text: "Here it is.", seq: 9520, t: "2026-11-11T16:40:00.000Z", writer: "described-shape-vessel", role: "described", id: "9".repeat(64) };

globalThis.fetch = (async (input: RequestInfo | URL) => {
  if (String(input).includes("/api/discovery/resolve")) return Response.json([ROW, REPLY, ONE]);
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
async function mount(): Promise<HTMLElement> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const entry = { pointer: { type: "record_read" }, form: "rows", title: "Rows", words: ["what", "text"] };
  await act(async () => {
    createRoot(el).render(React.createElement(QueryClientProvider, { client: qc }, React.createElement(Entries, { entries: [entry] as never, enabled: true, intervalMs: 60_000, onOpenQuestion: () => {} })));
  });
  await settle();
  return el;
}
/** A row's details, opened, as field name → its <dd>. */
function opened(el: HTMLElement, id: string): Map<string, HTMLElement> {
  const d = el.querySelector(`.sf-row[data-row="${id}"] details.sf-row-details`) as HTMLDetailsElement;
  d.open = true;
  return new Map([...d.querySelectorAll(".sf-row-field")].map((f) => [f.querySelector("dt")!.textContent!, f.querySelector("dd") as HTMLElement]));
}

describe("a row's opened details", () => {
  test("must-fail: an instant reads in the reader's zone; its exact value is on hover", async () => {
    const t = opened(await mount(), ID).get("t")!;
    const time = t.querySelector("time")!;
    expect(time.getAttribute("dateTime")).toBe(ROW.t);
    expect(time.getAttribute("title")).toBe(ROW.t);
    expect(t.textContent).not.toContain("T16:34");
    expect(t.textContent).toContain("4:34");
  });

  test("must-fail: an id is a short mark that still holds the whole id", async () => {
    const el = await mount();
    const id = opened(el, ID).get("id")!;
    const code = id.querySelector("code.sf-row-id")!;
    expect(code.textContent).toBe(ID);
    expect(code.getAttribute("title")).toBe(ID);
    // A UUID is an id too.
    expect(opened(el, REPLY.id).get("call id")!.querySelector("code.sf-row-id")!.textContent).toBe(CALL);
  });

  test("must-fail: several ids read as their count, folded over each id as a mark; one id is its mark; an empty list says none", async () => {
    const el = await mount();
    const f = opened(el, ID);
    expect(f.get("input refs")!.textContent).toBe("none");
    const refs = opened(el, REPLY.id).get("input refs")!;
    const fold = refs.querySelector("details.sf-row-ids-fold") as HTMLDetailsElement;
    expect(fold.open).toBe(false);
    expect(fold.querySelector("summary")!.textContent).toBe("5 ids");
    expect([...fold.querySelectorAll("code.sf-row-id")].map((c) => c.textContent)).toEqual(REFS);
    const one = opened(el, ONE.id).get("input refs")!;
    expect(one.querySelector("details")).toBeNull();
    expect(one.querySelector("code.sf-row-id")!.textContent).toBe(ID);
  });

  test("control: any other value is its text", async () => {
    const f = opened(await mount(), ID);
    expect(f.get("writer")!.textContent).toBe("a person");
    expect(f.get("seq")!.textContent).toBe("9510");
    expect(f.get("what")!.textContent).toBe(ROW.what);
    expect(f.get("shape")!.textContent).toBe("world_changed");
  });
});
