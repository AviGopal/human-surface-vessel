/**
 * The surface tells discovery what its view shapes do in the words of the contract a
 * view is checked against (src/ui-views.ts): region names, block names, what the
 * order of blocks means, the limits and the default. Goal recall matches goals against
 * these descriptions, so a shape advertised with no words for regions or order is never
 * offered for a goal about arranging the surface. Derived, not written per shape: a
 * different contract yields a different description.
 */
import { describe, expect, test } from "bun:test";
import { DISCOVERY_SHAPES } from "../src/config.ts";
import { REGISTRATION_PAYLOAD } from "../src/discovery-registration.ts";
import * as views from "../src/ui-views.ts";

const advertised = (): Record<string, string> =>
  ((REGISTRATION_PAYLOAD as unknown as { shape_descriptions?: Record<string, string> }).shape_descriptions ?? {});

describe("view shape descriptions come from the view contract", () => {
  test("uiView_write is advertised with every region and block, and what order means", () => {
    const d = advertised()["uiView_write"] ?? "";
    for (const [region, blocks] of Object.entries(views.VIEW_REGIONS)) {
      expect(d).toContain(`region ${region}`);
      for (const b of blocks) expect(d).toContain(b);
    }
    expect(d).toContain("in what order");
    expect(d).toContain("block");
  });

  test("human_surface:ui_view is advertised with the regions it reports", () => {
    const d = advertised()["human_surface:ui_view"] ?? "";
    for (const region of Object.keys(views.VIEW_REGIONS)) expect(d).toContain(`region ${region}`);
  });

  test("a different contract gives a different description", () => {
    const gen = (views as Record<string, unknown>)["viewShapeDescriptions"] as
      | ((c: unknown) => Record<string, string>)
      | undefined;
    expect(typeof gen).toBe("function");
    const out = gen!({
      regions: { margin: ["alpha_box", "beta_box"] },
      limits: { margin: { beta_box: { min: 2, max: 7 } } },
      defaults: { margin: { blocks: ["beta_box"] } },
    });
    expect(out["uiView_write"]).toContain("region margin: blocks alpha_box, beta_box; beta_box lists 2 to 7 items; default beta_box");
    expect(out["uiView_write"]).not.toContain("needs_you");
    expect(out["human_surface:ui_view"]).toContain("region margin");
  });

  test("control: only the shapes the contract serves are described, and all are advertised", () => {
    const keys = Object.keys(advertised()).sort();
    expect(keys).toEqual(["human_surface:ui_view", "uiView_write"]);
    // discovery keeps a description only for a shape in the same registration's `shapes`
    for (const k of keys) expect(DISCOVERY_SHAPES as readonly string[]).toContain(k);
    expect(REGISTRATION_PAYLOAD.shapes).toEqual([...DISCOVERY_SHAPES]);
  });
});
