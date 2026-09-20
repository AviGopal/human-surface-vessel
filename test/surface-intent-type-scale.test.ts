/**
 * The type scale must survive ordinary goal text, and must never flatten.
 *
 * Both defects here were reported by a human using the live surface: "every
 * interact with the goal execution box in human surface vessel results in the
 * text size decreasing." The surface shares one input box with goal dispatch
 * (the "change this surface" starter chip FILLS the box rather than sending),
 * so goal text reached the intent parser; the parser treated a bare number plus
 * any type-ish word as an absolute font size; and because each step was scaled
 * from its CURRENT value and clamped independently, one collapse to a bound
 * flattened the hierarchy permanently.
 *
 * The live policy was found at revision 12 with all six steps equal to 10.44px,
 * which is the 9px floor times one "bigger" step.
 */
import { test, expect, describe } from "bun:test";
import { readSurfaceIntent } from "../src/surface-intent.ts";
import type { RenderPolicy } from "../src/store.ts";

const DEFAULTS: RenderPolicy = {
  tokenOverrides: {},
  formByShape: {},
  maxPreviewChars: null,
  ledgerDefaultExpanded: true,
  presentation: "onepage",
  revision: 0,
  updatedAt: 0,
  note: null,
};

const TEXT_KEYS = ["--sf-text-xs", "--sf-text-sm", "--sf-text-base", "--sf-text-lg", "--sf-text-xl", "--sf-text-2xl"];

function read(text: string, policy: RenderPolicy = DEFAULTS) {
  const r = readSurfaceIntent(text, policy);
  // The reading carries a PATCH; the route is what merges it into the store.
  // Asserting on the patch is deliberate: it is what this parser is
  // responsible for, and it keeps the test independent of the write path.
  const tokens: Record<string, string> = r.patch.tokenOverrides ?? {};
  const textTokens = Object.fromEntries(Object.entries(tokens).filter(([k]) => k.startsWith("--sf-text")));
  const numeric = TEXT_KEYS.map(k => parseFloat(String(textTokens[k] ?? ""))).filter(n => Number.isFinite(n));
  return { reading: r, textTokens, numeric, distinct: new Set(Object.values(textTokens)).size };
}

/** A policy whose scale has already been flattened, as found live. */
const FLATTENED: RenderPolicy = {
  ...DEFAULTS,
  tokenOverrides: Object.fromEntries(TEXT_KEYS.map(k => [k, "10.44px"])),
  revision: 12,
};

describe("ordinary goal text must not restyle the surface", () => {
  // Each of these drove the whole scale to a clamp bound before the fix.
  const goals = [
    "resolve impulse type 3 and report the result",
    "Fix the type error in store.ts line 174",
    "Reduce the size of the payload to 2 items",
    "run the type audit over 12 vessels",
  ];
  for (const goal of goals) {
    test(`leaves the type scale untouched: "${goal.slice(0, 40)}"`, () => {
      const { textTokens, reading } = read(goal);
      expect(Object.keys(textTokens)).toEqual([]);
      // Refusing to restyle is not the same as silently ignoring the clause:
      // the parser must still be able to say it read nothing stylable here.
      expect(reading.changes.some((c: { field: string }) => c.field.startsWith("tokenOverrides (type scale)"))).toBe(false);
    });
  }
});

describe("real size instructions still work", () => {
  test("an explicit unit sets the base and KEEPS the hierarchy", () => {
    const { textTokens, numeric, distinct } = read("set the text to 16px");
    expect(textTokens["--sf-text-base"]).toBe("16px");
    expect(distinct).toBeGreaterThan(1); // not flattened
    // strictly increasing across the scale
    expect(numeric).toEqual([...numeric].sort((a, b) => a - b));
    expect(new Set(numeric).size).toBe(numeric.length);
  });

  test("an explicit setter without a unit still works", () => {
    const { textTokens, distinct } = read("set the text to 16");
    expect(parseFloat(String(textTokens["--sf-text-base"]))).toBeCloseTo(16, 1);
    expect(distinct).toBeGreaterThan(1);
  });

  test("relative bigger scales every step and keeps the hierarchy", () => {
    const { numeric, distinct } = read("make the text bigger");
    expect(distinct).toBeGreaterThan(1);
    expect(numeric[0]!).toBeGreaterThan(0);
    expect(numeric).toEqual([...numeric].sort((a, b) => a - b));
  });
});

describe("the scale cannot be permanently flattened", () => {
  test("a flattened policy REPAIRS itself on the next instruction", () => {
    // This is the regression clamp for the live defect: before the fix, scaling
    // from the current values kept six equal numbers equal forever.
    const { numeric, distinct } = read("make the text bigger", FLATTENED);
    expect(distinct).toBeGreaterThan(1);
    expect(numeric).toEqual([...numeric].sort((a, b) => a - b));
  });

  test("an extreme request compresses the ends without flattening the middle", () => {
    const { numeric, textTokens } = read("set the text to 9px");
    // xs/sm may both land on the floor — that is the documented end-compression.
    // The upper steps must remain distinct from the floor.
    expect(parseFloat(String(textTokens["--sf-text-2xl"]))).toBeGreaterThan(
      parseFloat(String(textTokens["--sf-text-base"])),
    );
    expect(new Set(numeric).size).toBeGreaterThan(1);
  });

  test("reset clears the overrides entirely", () => {
    const { textTokens } = read("reset to defaults", FLATTENED);
    expect(Object.keys(textTokens)).toEqual([]);
  });
});
