/**
 * On the landing a section is not a box: a hairline and space set it apart, and only "Waiting on
 * you" is raised, and only while a question waits. A box on every section made an empty "Waiting
 * on you" weigh as much as the person's asks (USER's hub page, 11-14).
 *
 * A static read of the stylesheet: the DOM test environment does not apply `:has()` or the
 * cascade, so the rendered check (1280 and 420, light and dark) is the commit's.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../ui/src/styles.css", import.meta.url), "utf8");
const rule = (selector: string): string => {
  const at = css.indexOf(`${selector} {`);
  return at < 0 ? "" : css.slice(at, css.indexOf("}", at));
};

describe("the landing's sections", () => {
  test("must-fail: a landing section draws no box of its own", () => {
    const r = rule(".sf-landing .sf-report");
    expect(r).toContain("background: none");
    expect(r).toContain("border: 0");
  });

  test("must-fail: only the questions entry is raised, and only while it lists a question", () => {
    const r = rule('.sf-landing .sf-report[data-form="questions"]:has(.sf-landing-list > li)');
    expect(r).toContain("background: var(--sf-panel)");
    expect(r).toContain("border: 1px solid var(--sf-accent)");
  });
});
