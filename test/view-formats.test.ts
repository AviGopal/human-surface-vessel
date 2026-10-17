/**
 * Task 11: the run outcome as a view in two wire formats, decoded to one tree and
 * drawn from the same primitives. The data is the fabricated-person run's
 * outcome (fixture), so the view must carry the provenance mark.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://surface.test/" });

import { afterAll, describe, expect, test } from "bun:test";

const uiSrc = new URL("../ui/src/", import.meta.url).pathname;
const React = await import(Bun.resolveSync("react", uiSrc));
const { renderToStaticMarkup } = await import(Bun.resolveSync("react-dom/server", uiSrc));
const { decodeA2ui, decodeNested } = await import("../ui/src/views/view");
const { Draw, checkBindings } = await import("../ui/src/views/Draw");

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

const data = {
  run: { goal: "Where is it raining in the world right now? Rank by latitude.", state: "reached" },
  answer: { provenance: "no person asked", text: "concept search: raining, 0 of 30 matched" },
  verdict: "The output provided a ranked list of current rainfall locations by latitude, fulfilling the goal.",
};

const nested = {
  primitive: "Stack",
  children: [
    { primitive: "Heading", props: { text: { path: "/run/goal" } } },
    { primitive: "Mark", props: { text: { path: "/answer/provenance" } } },
    { primitive: "Text", props: { text: { path: "/answer/text" } } },
    { primitive: "Fold", props: { label: "Verdict" }, children: [{ primitive: "Text", props: { text: { path: "/verdict" } } }] },
  ],
};

const a2ui = [
  { id: "root", component: "Stack", children: ["goal", "mark", "answer", "why"] },
  { id: "goal", component: "Heading", text: { path: "/run/goal" } },
  { id: "mark", component: "Mark", text: { path: "/answer/provenance" } },
  { id: "answer", component: "Text", text: { path: "/answer/text" } },
  { id: "why", component: "Fold", label: "Verdict", child: "verdict" },
  { id: "verdict", component: "Text", text: { path: "/verdict" } },
];

describe("view formats", () => {
  test("both formats decode to the same tree and draw the same page", () => {
    const n = decodeNested(nested);
    const a = decodeA2ui(a2ui);
    expect(n.ok && a.ok).toBe(true);
    if (!n.ok || !a.ok) return;
    expect(a.root).toEqual(n.root);
    expect(checkBindings(a.root, data)).toBeNull();
    const html = renderToStaticMarkup(React.createElement(Draw, { node: a.root, data }));
    expect(html).toBe(renderToStaticMarkup(React.createElement(Draw, { node: n.root, data })));
    expect(html).toContain("no person asked");
    expect(html).toContain("<summary>Verdict</summary>");
  });

  test("an unknown primitive, an unknown prop or a broken link fails the whole view", () => {
    expect(decodeNested({ primitive: "Script", props: { src: "x" } })).toEqual({ ok: false, error: 'unknown primitive "Script"' });
    expect(decodeA2ui([{ id: "root", component: "Text", text: "x", onClick: "alert(1)" }])).toEqual({ ok: false, error: 'Text has no prop "onClick"' });
    expect(decodeA2ui([{ id: "root", component: "Stack", children: ["missing"] }])).toEqual({ ok: false, error: 'no component "missing"' });
    expect(decodeA2ui([{ id: "root", component: "Stack", children: ["root"] }]).ok).toBe(false);
  });

  test("a binding that resolves to nothing fails the view, so the region falls back", () => {
    const a = decodeA2ui([{ id: "root", component: "Text", text: { path: "/answer/missing" } }]);
    expect(a.ok && checkBindings(a.root, data)).toBe("Text.text: /answer/missing does not resolve to text");
  });
});
