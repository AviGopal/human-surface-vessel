/**
 * A resolver reply can carry its answer as an encoded string:
 * `{"success":true,"content":"{\"a\":1,…}"}`. When the 2,000-character preview
 * cuts such a reply, the cut falls inside that string, so what arrives of the
 * answer is cut JSON. It was planned as finished text, and the screen showed
 * escaped JSON.
 *
 * Shape: one node 10-21, "What servers are running on our local network?" drew
 * its topologyCoverage output (3,283 chars, previewed at 2,000) as one line of
 * `{"distinct_pool_signatures":6334,…`, while a sibling output cut the same way
 * without the wrapper drew as fields.
 */
import { describe, expect, test } from "bun:test";
import { CUT_KEY, planContent } from "../ui/src/lib/ledger.ts";

const inner = JSON.stringify({ total: 6334, top: [{ sig: "c2", count: 257351 }, { sig: "8e", count: 138568 }], more: "x".repeat(60) });
/** The reply cut part-way into its third member, as a preview cut does. */
const cutAt = (wrapper: (s: string) => string, at: number): string => wrapper(inner).slice(0, at);

describe("a reply whose encoded answer was cut", () => {
  test("must-fail: {success, content} cut inside the answer draws the answer's whole members, not escaped JSON", () => {
    const preview = cutAt((s) => JSON.stringify({ success: true, content: s }), 120);
    expect(preview.endsWith("}")).toBe(false);
    const p = planContent("topologyCoverage", preview, true);
    expect(p.form).not.toBe("text");
    expect(p.decidedBy).toBe("partial_json");
    expect(p.text).not.toContain('\\"');
    const v = JSON.parse(p.text) as Record<string, unknown>;
    expect(v["total"]).toBe(6334);
    expect((v["top"] as unknown[])[0]).toEqual({ sig: "c2", count: 257351 });
    // The cut is marked where it fell; nothing past it is invented.
    expect(JSON.stringify(v)).toContain(CUT_KEY);
    expect(v["more"]).toBeUndefined();
  });

  test("must-fail: {success, body} with the body as an encoded string reads the same way", () => {
    const preview = cutAt((s) => JSON.stringify({ success: true, shape: "topologyCoverage", body: s }), 120);
    const p = planContent("topologyCoverage", preview, true);
    expect(p.form).not.toBe("text");
    expect(p.text).not.toContain('\\"');
    expect((JSON.parse(p.text) as Record<string, unknown>)["total"]).toBe(6334);
  });

  test("an answer that arrived whole before a later cut is read whole", () => {
    const preview = JSON.stringify({ success: true, content: JSON.stringify({ a: 1 }), metadata: { summary: "one row" } }).slice(0, -8);
    const p = planContent("s", preview, true);
    expect(JSON.parse(p.text)).toEqual({ a: 1 });
  });

  test("cut text that is not JSON stays the text that arrived", () => {
    const report = "The scan found three hosts on the subnet.\n\nThe first of them answered on port 22 and port 80, and ".repeat(4);
    const preview = JSON.stringify({ success: true, content: report }).slice(0, 200);
    const p = planContent("report", preview, true);
    expect(p.text.startsWith("The scan found three hosts")).toBe(true);
    expect(p.text).not.toContain(CUT_KEY);
  });

  test("an answer that only looks like JSON and is malformed before the cut is not read as structure", () => {
    const preview = JSON.stringify({ success: true, content: '{"a" 1, "b": "long enough to be cut somewhere in here' }).slice(0, 50);
    const p = planContent("s", preview, true);
    expect(p.decidedBy).not.toBe("partial_json");
  });
});
