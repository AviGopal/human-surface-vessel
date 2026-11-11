/**
 * The surface tells discovery what its view shapes do in the words of the contract a
 * view is checked against (src/ui-views.ts): region names, the entry and its forms, what
 * the order of entries means, and the default. Goal recall matches goals against
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
  test("uiView_write is advertised with every region and form, and what order means", () => {
    const d = advertised()["uiView_write"] ?? "";
    for (const region of views.VIEW_REGIONS) expect(d).toContain(region);
    for (const form of views.ENTRY_FORMS) expect(d).toContain(form);
    expect(d).toContain("{region, entries, note?}");
    expect(d).toContain("in list order");
    expect(d).toContain("succeeds as unchanged");
    expect(d).not.toContain("block");
  });

  test("human_surface:ui_view is advertised with the regions it reports, and the view it passed over", () => {
    const d = advertised()["human_surface:ui_view"] ?? "";
    for (const region of views.VIEW_REGIONS) expect(d).toContain(region);
    expect(d).toContain("not drawn");
  });

  test("a different contract gives a different description", () => {
    const gen = (views as Record<string, unknown>)["viewShapeDescriptions"] as
      | ((c: unknown) => Record<string, string>)
      | undefined;
    expect(typeof gen).toBe("function");
    const out = gen!({
      regions: ["margin"],
      defaults: { margin: { entries: [{ pointer: { type: "tide_table" }, form: "fields", title: "Tides" }, { pointer: { type: "moon_phase" }, form: "fields" }] } },
    });
    expect(out["uiView_write"]).toContain("(margin)");
    expect(out["uiView_write"]).toContain("default margin: Tides, moon_phase");
    expect(out["uiView_write"]).not.toContain("landing");
    expect(out["human_surface:ui_view"]).toContain("(margin)");
  });

  test("control: only the shapes the contract serves are described, and all are advertised", () => {
    const keys = Object.keys(advertised()).sort();
    expect(keys).toEqual(["human_surface:ui_view", "uiView_write"]);
    // discovery keeps a description only for a shape in the same registration's `shapes`
    for (const k of keys) expect(DISCOVERY_SHAPES as readonly string[]).toContain(k);
    expect(REGISTRATION_PAYLOAD.shapes).toEqual([...DISCOVERY_SHAPES]);
  });
});
