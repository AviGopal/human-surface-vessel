/**
 * The surface tells discovery the pointer fields `uiView_write` reads (shape_inputs), so the walk's
 * request producer, which reads only shapes with declared inputs, sees the view vocabulary when it
 * writes. The schema comes from the contract a write is checked against, so the two cannot drift:
 * the fields an entry may have, the forms, judges and regions are the write's own, and every
 * default view, which the write accepts, fits the schema.
 *
 * Shape: node1 11-16, the walk could call uiView_write (hsv serves it, no owner row blocks it) but
 * hsv declared no inputs, so the shape and its description were left out of the request
 * producer's shapeDescriptions read (declared: true) and no walk ever wrote a view.
 */
import { describe, expect, test } from "bun:test";
import { REGISTRATION_PAYLOAD } from "../src/discovery-registration.ts";
import * as views from "../src/ui-views.ts";

type Schema = Record<string, unknown>;
const declared = (): Schema | undefined =>
  ((REGISTRATION_PAYLOAD as unknown as { shape_inputs?: Record<string, Schema> }).shape_inputs ?? {})["uiView_write"];

/** The subset of JSON Schema the declaration uses; enough to say whether a value fits it. */
function fits(s: Schema, v: unknown): boolean {
  if ("const" in s && v !== s["const"]) return false;
  if (Array.isArray(s["enum"]) && !(s["enum"] as unknown[]).includes(v)) return false;
  if (Array.isArray(s["anyOf"])) return (s["anyOf"] as Schema[]).some((x) => fits(x, v));
  const types = s["type"] === undefined ? [] : Array.isArray(s["type"]) ? (s["type"] as string[]) : [s["type"] as string];
  const kind = Array.isArray(v) ? "array" : v === null ? "null" : Number.isInteger(v) ? "integer" : typeof v;
  if (types.length > 0 && !types.some((t) => t === kind || (t === "number" && kind === "integer"))) return false;
  if (typeof v === "string") {
    if (typeof s["minLength"] === "number" && v.length < s["minLength"]) return false;
    if (typeof s["maxLength"] === "number" && v.length > s["maxLength"]) return false;
    if (typeof s["pattern"] === "string" && !new RegExp(s["pattern"]).test(v)) return false;
  }
  if (typeof v === "number") {
    if (typeof s["minimum"] === "number" && v < s["minimum"]) return false;
    if (typeof s["maximum"] === "number" && v > s["maximum"]) return false;
  }
  if (Array.isArray(v)) {
    if (typeof s["minItems"] === "number" && v.length < s["minItems"]) return false;
    if (typeof s["maxItems"] === "number" && v.length > s["maxItems"]) return false;
    if (s["items"] && !v.every((x) => fits(s["items"] as Schema, x))) return false;
  }
  if (kind === "object") {
    const o = v as Record<string, unknown>;
    const props = (s["properties"] ?? {}) as Record<string, Schema>;
    if (Array.isArray(s["required"]) && !(s["required"] as string[]).every((k) => k in o)) return false;
    if (typeof s["minProperties"] === "number" && Object.keys(o).length < s["minProperties"]) return false;
    if (typeof s["maxProperties"] === "number" && Object.keys(o).length > s["maxProperties"]) return false;
    for (const [k, x] of Object.entries(o)) {
      if (props[k]) {
        if (!fits(props[k]!, x)) return false;
      } else if (s["additionalProperties"] === false) return false;
      else if (typeof s["additionalProperties"] === "object" && !fits(s["additionalProperties"] as Schema, x)) return false;
    }
  }
  return true;
}

const entrySchema = (): Schema => ((declared()!["properties"] as Record<string, Schema>)["entries"]!["items"]) as Schema;

describe("uiView_write declares its inputs, from the contract a write is checked against", () => {
  test("must-fail: the registration declares uiView_write's inputs", () => {
    const s = declared();
    expect(s).toBeDefined();
    expect(s!["required"]).toEqual(["region"]);
    expect((s!["properties"] as Record<string, Schema>)["region"]!["enum"]).toEqual([...views.VIEW_REGIONS]);
  });

  test("must-fail: an entry's fields in the schema are exactly the fields a write accepts", () => {
    views.resetViewsForTest();
    const refused = views.writeView({ region: "landing", entries: [{ pointer: { type: "record_read", shape: "answer" }, form: "rows", zz: 1 }] }, null);
    const listed = refused.ok ? "" : refused.detail;
    const accepted = /an entry has (.+) only/.exec(listed)![1]!.replace(" and ", ", ").split(", ").sort();
    expect(Object.keys(entrySchema()["properties"] as object).sort()).toEqual(accepted);
  });

  test("forms, judges and limits are the write's own", () => {
    const p = entrySchema()["properties"] as Record<string, Schema>;
    expect(p["form"]!["enum"]).toEqual([...views.ENTRY_FORMS]);
    expect(p["judge"]!["enum"]).toEqual([...views.JUDGE_KINDS]);
    expect(p["note"]!["maxLength"]).toBe(120);
  });

  test("must-fail: every default view, which a write accepts, fits the schema", () => {
    for (const region of views.VIEW_REGIONS) {
      const entries = views.currentView(region).entries;
      expect(fits(declared()!, { region, entries })).toBe(true);
      views.resetViewsForTest();
      expect(views.writeView({ region, entries }, null).ok).toBe(true);
    }
  });

  test("must-fail: the declaration uses only the schema words the walk's check judges, so a walk can call it", () => {
    // Copied from walk-vessel src/inputs.ts KNOWN at e4773c6: a declaration using any other word fails that check, and the walk offers no call.
    const judged = new Set(["type", "required", "properties", "additionalProperties", "items", "enum", "const", "minLength", "maxLength", "pattern", "minimum", "maximum", "minItems", "maxItems", "description", "title", "examples", "default"]);
    const unjudged: string[] = [];
    const visit = (s: unknown, at: string): void => {
      if (typeof s !== "object" || s === null || Array.isArray(s)) return;
      const o = s as Schema;
      for (const k of Object.keys(o)) if (!judged.has(k)) unjudged.push(`${at}: ${k}`);
      for (const [k, sub] of Object.entries((o["properties"] ?? {}) as Record<string, unknown>)) visit(sub, `${at}.${k}`);
      visit(o["items"], `${at}[]`);
      visit(o["additionalProperties"], `${at}.*`);
    };
    visit(declared(), "uiView_write");
    expect(unjudged).toEqual([]);
  });

  test("a thread is one entry or a list of them, under one schema", () => {
    const thread = (entrySchema()["properties"] as Record<string, Schema>)["thread"]!;
    const one = { pointer: { type: "record_read", refs_to: "$row", shape: "answer" }, form: "rows" };
    expect(fits(thread, one)).toBe(true);
    expect(fits(thread, [one, one])).toBe(true);
    expect(fits(thread, [])).toBe(false);
    expect(fits(thread, { ...one, zz: 1 })).toBe(false);
  });

  test("must-fail: each declaration fits what discovery keeps, so none is dropped and every shape stays callable", () => {
    // discovery-vessel resolvers.ts sanitizeShapeInputs: a shape's schema over 8,192 characters (JSON.stringify length),
    // one naming an address, or one past 65,536 in all is dropped without a word. uiView_write's came to 18,191, so the
    // walk read no inputs for it and skipped every view write, a person's undo and return-to-default included.
    const ADDRESS = /[a-z][a-z0-9+.-]*:\/\/|\b\d{1,3}(?:\.\d{1,3}){3}\b|\[[0-9a-f]*:[0-9a-f:]*\](?::\d{2,5})?|\b[a-z][a-z0-9.-]*:\d{2,5}\b/i;
    const all = (REGISTRATION_PAYLOAD as unknown as { shape_inputs: Record<string, Schema> }).shape_inputs;
    let total = 0;
    for (const [shape, schema] of Object.entries(all)) {
      const text = JSON.stringify(schema);
      expect({ shape, over: text.length > 8_192, address: ADDRESS.test(text) }).toEqual({ shape, over: false, address: false });
      total += text.length;
    }
    expect(total).toBeLessThanOrEqual(65_536);
    expect(Object.keys(all).sort()).toEqual(["human_surface:ui_view", "uiView_write"]);
  });

  test("a thread's list is declared by its entries' required fields, and the write checks them in full", () => {
    const thread = (entrySchema()["properties"] as Record<string, Schema>)["thread"]!;
    const one = { pointer: { type: "record_read", refs_to: "$row", shape: "answer" }, form: "rows" };
    expect(fits(thread, [{ ...one, zz: 1 }])).toBe(true);
    expect(fits(thread, [{ form: "rows" }])).toBe(false);
    views.resetViewsForTest();
    const w = views.writeView({ region: "landing", entries: [{ pointer: { type: "record_read", shape: "world_changed" }, form: "rows", thread: [{ ...one, zz: 1 }] }] }, "walk");
    expect(w.ok).toBe(false);
    views.resetViewsForTest();
  });

  test("control: a write the contract refuses does not fit either", () => {
    expect(fits(declared()!, { region: "margin" })).toBe(false);
    expect(fits(declared()!, { region: "landing", entries: [{ pointer: { type: "record_read", shape: "answer" }, form: "table" }] })).toBe(false);
    expect(fits(declared()!, { region: "landing", entries: [{ pointer: { type: "record_read", shape: "answer" }, form: "rows", zz: 1 }] })).toBe(false);
  });
});
