/**
 * Numbers in records and tables read as a person would say them. Records drew
 * long fractions digit for digit (phase 2 visual check, 10-17), and one node's
 * render policy carried weights near 3.9e29. The full value stays in the title.
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://surface.test/" });

import { afterAll, describe, expect, test } from "bun:test";
import { teardownDom, trackRoot } from "./setup.ts";

const uiSrc = new URL("../ui/src/", import.meta.url).pathname;
const React = await import(Bun.resolveSync("react", uiSrc));
const { createRoot: rawCreateRoot } = await import(Bun.resolveSync("react-dom/client", uiSrc));
const createRoot = (...a: Parameters<typeof rawCreateRoot>) => trackRoot(rawCreateRoot(...a));
const { act } = React;
const { ContentRender } = await import("../ui/src/components/ContentRender");
const { readableNumber, parseRows } = await import("../ui/src/lib/ledger");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterAll(async () => {
  await teardownDom();
});

describe("readable numbers", () => {
  test("whole numbers and short fractions are left as they are", () => {
    expect(readableNumber(42)).toEqual({ text: "42" });
    expect(readableNumber(0.8)).toEqual({ text: "0.8" });
    expect(readableNumber(-3.25)).toEqual({ text: "-3.25" });
  });

  test("long fractions are cut, with the exact value kept", () => {
    expect(readableNumber(0.8333333333333334)).toEqual({ text: "0.8333", exact: "0.8333333333333334" });
    expect(readableNumber(1234.5678)).toEqual({ text: "1234.57", exact: "1234.5678" });
    expect(readableNumber(1.2395022e32)).toEqual({ text: "1.24e+32", exact: "1.2395022e+32" });
    expect(readableNumber(0.0000123)).toEqual({ text: "1.23e-5", exact: "0.0000123" });
  });

  test("table cells use the same reading", () => {
    const rows = parseRows(JSON.stringify([{ kind: "a", weight: 0.8333333333333334 }]))!;
    const c = rows.rows[0]![rows.columns.indexOf("weight")]!;
    expect([c.text, c.title]).toEqual(["0.8333", "0.8333333333333334"]);
  });

  test("must-fail: a record draws a long fraction cut, with the exact value in its title", async () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const text = JSON.stringify({ target: "webSearchResult", confidence: 0.8333333333333334, nested: { weight: 1.2395022e32 } });
    await act(async () => {
      createRoot(el).render(React.createElement(ContentRender, { plan: { form: "record", text, decidedBy: "test" } }));
    });
    const values = [...el.querySelectorAll(".sf-scalar-value.sf-mono")].map((v) => [v.textContent, v.getAttribute("title")]);
    expect(values).toEqual([
      ["0.8333", "0.8333333333333334"],
      ["1.24e+32", "1.2395022e+32"],
    ]);
  });
});
