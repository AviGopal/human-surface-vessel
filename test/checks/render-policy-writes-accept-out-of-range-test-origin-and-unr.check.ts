/**
 * Check for gap render-policy-writes-accept-out-of-range-test-origin-and-unrendered-template-values.
 *
 * Red until the renderPolicy_write path refuses what it cannot use safely.
 * Evidence (one node, renderPolicy revision 17996, 10-17): importanceWeights.byKind
 * held the learned kind "{{goal.kind}}" (an unrendered template) and 18
 * learnerprobe_* kinds written by a test run, now 1.24e32 to 8.8e75.
 *
 * Expected: a write whose byKind holds a key with a template placeholder, or a
 * weight above the declared bound, is refused; the refusal names the key; the
 * policy is unchanged. An in-range write over a real kind still applies.
 */
import { describe, expect, test } from "bun:test";
import { impulsesRouter } from "../../src/routes/impulses.ts";

async function resolve(pointer: Record<string, unknown>) {
  const res = await impulsesRouter.request("/v2/impulses/resolve", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pointer }),
  });
  return { status: res.status, json: (await res.json()) as any };
}
const policy = async () => (await resolve({ type: "renderPolicy" })).json.body;

describe("render policy write checks", () => {
  test("a byKind key holding a template placeholder is refused, named, and changes nothing", async () => {
    const before = await policy();
    const r = await resolve({ type: "renderPolicy_write", importanceWeights: { byKind: { "{{goal.kind}}": 2 } }, assigned_by: "check" });
    const after = await policy();
    expect(r.json.applied === false || r.json.resolved === false).toBe(true);
    expect(JSON.stringify(r.json)).toContain("{{goal.kind}}");
    expect(after.revision).toBe(before.revision);
    expect(Object.keys(after.importanceWeights.byKind)).not.toContain("{{goal.kind}}");
  });

  test("a weight above the declared bound is refused, named, and changes nothing", async () => {
    const before = await policy();
    const r = await resolve({ type: "renderPolicy_write", importanceWeights: { byKind: { question: 1.2400569119633332e32 } }, assigned_by: "check" });
    const after = await policy();
    expect(r.json.applied === false || r.json.resolved === false).toBe(true);
    expect(JSON.stringify(r.json)).toContain("question");
    expect(after.revision).toBe(before.revision);
    expect(after.importanceWeights.byKind.question).toBe(before.importanceWeights.byKind.question);
  });

  test("control: an in-range write over a real kind still applies", async () => {
    const r = await resolve({ type: "renderPolicy_write", importanceWeights: { byKind: { question: 3.5 } }, assigned_by: "check" });
    expect(r.json.applied === false).toBe(false);
    expect((await policy()).importanceWeights.byKind.question).toBe(3.5);
  });
});
