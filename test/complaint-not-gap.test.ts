/**
 * A complaint is the person's world_changed row, not a gap this surface files.
 */
import { describe, expect, test } from "bun:test";
import { testAuth } from "./setup.ts";
import { impulsesRouter } from "../src/routes/impulses.ts";

describe("a complaint is not a gap this surface files", () => {
  test("must-fail: uiFeedback refuses complaint_kind by name and files nothing", async () => {
    const original = globalThis.fetch;
    const outbound: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      outbound.push(`${String(input)} ${String(init?.body ?? "")}`);
      return new Response("{}");
    }) as unknown as typeof fetch;
    try {
      const post = (pointer: Record<string, unknown>) =>
        impulsesRouter.request("/v2/impulses/resolve", {
          method: "POST",
          headers: { "content-type": "application/json", ...testAuth() },
          body: JSON.stringify({ impulse: { pointer } }),
        });
      const complaint = await post({ type: "uiFeedback", panel_id: "the surface", response_id: crypto.randomUUID(), value: "unreadable", kind: "reaction", complaint_kind: "wrong" });
      expect(complaint.status).toBe(422);
      expect((await complaint.json()).error).toContain("world_changed");
      expect(outbound.filter((o) => o.includes("substrateGap"))).toEqual([]);
      const plain = await (await post({ type: "uiFeedback", panel_id: "the surface", response_id: crypto.randomUUID(), value: "fine", kind: "reaction" })).json();
      expect(plain.success).toBe(true);
      expect(plain.body.filed_gap_id).toBeUndefined();
    } finally {
      globalThis.fetch = original;
    }
  });
});
