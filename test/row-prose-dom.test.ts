/**
 * A row's text words are drawn as the writer formatted them (surface-acts-on-shapes-present R.6):
 * emphasis, lists and paragraphs through the surface's own Prose, which builds elements and
 * never markup. A single line break in a row stays a line break, as its writer wrote it; a blank
 * line starts a paragraph. Raw HTML in a row is drawn as text; a link is its label and its target as text,
 * never an anchor. A word that is not text (an outcome's `r`) stays a plain line.
 *
 * Shapes: one node 11-11. The walk's answer to "What is happening in the world today?" was a
 * markdown list, drawn as its raw marks: "*   **Geopolitical conflicts and international
 * relations?** (e.g., …)".
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://surface.test/" });

import { afterAll, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { teardownDom, trackRoot } from "./setup.ts";

const HEX = "d14cd8507ea56c9411e85ac0a3b8720b1db42c2ffdbc63ece14a2fe28af4db4d";
const LIST =
  "Global events are constantly unfolding. For example, are you looking for news on:\n\n" +
  "*   **Geopolitical conflicts?** (e.g., specific wars)\n" +
  "*   **Economic trends and markets?** (e.g., inflation)\n\n" +
  "Once you narrow down your interest, I can provide a more *focused* answer.";
const HOSTILE =
  'Before <script>window.__ran = 1</script> and <img src="x" onerror="window.__ran = 2"> after.\n\n' +
  "See [the source](javascript:window.__ran=3) and [a page](https://example.org/a).";
const answer = (n: number, text: string) => ({ input_refs: [HEX], text, shape: "answer", seq: n, t: "2026-11-11T13:34:30.000Z", writer: "described-shape-vessel", role: "described", id: String(n).padEnd(64, "a") });
const LINES = "12 Main St\nSpringfield\n\nA second paragraph.";
const ROWS = [answer(1, LIST), answer(2, HOSTILE), answer(4, LINES)];
const OUTCOME = { input_refs: [HEX], r: 0, shape: "outcome", seq: 3, t: "2026-11-11T13:34:36.000Z", writer: "described-shape-vessel", role: "described", id: "3".padEnd(64, "b") };

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.includes("/api/discovery/resolve")) {
    const pointer = JSON.parse(String(init?.body)).pointer as Record<string, unknown>;
    if (pointer["type"] === "record_read" && pointer["shape"] === "answer") return Response.json(ROWS);
    if (pointer["type"] === "record_read" && pointer["shape"] === "outcome") return Response.json([OUTCOME]);
    if (pointer["type"] === "record_read") return Response.json([]);
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
async function mount(entries: unknown[]): Promise<HTMLElement> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    createRoot(el).render(React.createElement(QueryClientProvider, { client: qc }, React.createElement(Entries, { entries: entries as never, enabled: true, intervalMs: 60_000, onOpenQuestion: () => {} })));
  });
  await settle();
  return el;
}
const answers = { pointer: { type: "record_read", shape: "answer" }, form: "rows", words: ["text"] };
/** A row's words, without its folded record. */
const words = (el: HTMLElement, n: number): Element => el.querySelector(`.sf-row[data-row="${String(n).padEnd(64, "a")}"]`)!;
const inView = (row: Element): Element => {
  const copy = row.cloneNode(true) as Element;
  copy.querySelectorAll("details").forEach((n) => n.remove());
  return copy;
};

describe("a row's text words are drawn as the writer formatted them", () => {
  test("must-fail: a markdown answer draws its list and emphasis, with none of its marks in view", async () => {
    const el = await mount([answers]);
    const row = inView(words(el, 1));
    expect([...row.querySelectorAll("ul > li")].map((li) => li.textContent)).toEqual(["Geopolitical conflicts? (e.g., specific wars)", "Economic trends and markets? (e.g., inflation)"]);
    expect([...row.querySelectorAll("strong")].map((s) => s.textContent)).toEqual(["Geopolitical conflicts?", "Economic trends and markets?"]);
    expect(row.querySelector("em")!.textContent).toBe("focused");
    expect(row.textContent).not.toContain("**");
    expect(row.textContent).not.toMatch(/(^|\s)\*\s/);
  });

  test("must-fail: a single line break stays a line break, and a blank line starts a paragraph", async () => {
    const el = await mount([answers]);
    const paras = [...inView(words(el, 4)).querySelectorAll(".sf-prose > p")];
    expect(paras.length).toBe(2);
    expect([...paras[0]!.childNodes].map((n) => (n.nodeName === "BR" ? "\n" : n.textContent)).join("")).toBe("12 Main St\nSpringfield");
    expect(paras[1]!.textContent).toBe("A second paragraph.");
  });

  test("must-fail: raw HTML is drawn as text, never as elements, and runs nothing", async () => {
    (window as unknown as { __ran?: number }).__ran = 0;
    const el = await mount([answers]);
    const row = inView(words(el, 2));
    expect(row.querySelectorAll("script, img, iframe, a, [onerror]").length).toBe(0);
    expect(row.textContent).toContain("<script>window.__ran = 1</script>");
    expect(row.textContent).toContain('<img src="x" onerror="window.__ran = 2">');
    expect((window as unknown as { __ran?: number }).__ran).toBe(0);
  });

  test("must-fail: a link is its label and its target as text, never an anchor", async () => {
    const el = await mount([answers]);
    const row = inView(words(el, 2));
    expect(row.querySelectorAll("a").length).toBe(0);
    expect(row.textContent).toContain("the source (javascript:window.__ran=3)");
    expect(row.textContent).toContain("a page (https://example.org/a)");
  });

  test("must-fail: a word that is not text stays one plain line", async () => {
    const el = await mount([{ pointer: { type: "record_read", shape: "outcome" }, form: "rows", words: ["r"] }]);
    const row = el.querySelector(`.sf-row[data-row="${OUTCOME.id}"]`)!;
    const line = row.querySelector(".sf-row-words")!;
    expect(line.tagName).toBe("P");
    expect(line.textContent).toBe("r 0");
  });
});

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

test("must-fail: nothing in the surface's page sets markup from a string", () => {
  const found = sources(uiSrc).filter((f) => /dangerouslySetInnerHTML\s*[=:]|\.innerHTML\s*=|insertAdjacentHTML\(|outerHTML\s*=/.test(readFileSync(f, "utf8")));
  expect(found).toEqual([]);
});
