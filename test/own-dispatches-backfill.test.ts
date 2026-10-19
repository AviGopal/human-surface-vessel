/**
 * "Mine" rebuilt from goal-host's listing when the surface's own record is empty
 * (routes/proxy.ts backfillOwnDispatches). goal-host's auth fix (gh 7b048e2) moves the
 * caller's `operator` to `operator_label` and makes `operator` authority, null for this
 * vessel's key. A backfill that reads only `operator` then finds none of the surface's
 * runs. It must read the label, falling back to `operator` for rows written before.
 * Own process (bun runs each file in one), so the record starts empty under setup.ts's
 * throwaway workspace.
 */
import { describe, expect, test } from "bun:test";
import { Hono } from "hono";

const rows = [
  // After gh 7b048e2: the label carries the surface, operator is authority (null here).
  { dispatchId: "new-1", goal: "asked after the auth fix", operator: null, operator_label: "human-surface", status: "completed", reached: true, startedAt: Date.UTC(2026, 9, 19, 9) },
  // Before it: operator was the label.
  { dispatchId: "old-1", goal: "asked before the auth fix", operator: "human-surface", status: "failed", reached: false, startedAt: Date.UTC(2026, 9, 18, 9) },
  // Not the surface's, by either field.
  { dispatchId: "sys-1", goal: "system", operator: null, operator_label: "rhythm-conductor-drain", status: "completed", reached: true, startedAt: Date.UTC(2026, 9, 19, 8) },
];
globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
  const body = JSON.parse(String(init?.body ?? "{}")) as { type?: string; pointer?: { type?: string } };
  const type = body.type ?? body.pointer?.type ?? "";
  if (type === "vesselCapability") return new Response(JSON.stringify({ content: { vessels: [] } }), { status: 200 });
  if (type === "activeDispatches") return new Response(JSON.stringify({ resolved: true, body: { dispatches: rows, nextOffset: null } }), { status: 200 });
  return new Response(JSON.stringify({ resolved: false }), { status: 200 });
}) as typeof fetch;

const { proxyRouter } = await import("../src/routes/proxy.ts");
const { listOwnDispatches } = await import("../src/own-dispatches.ts");
const app = new Hono();
app.route("/", proxyRouter);

describe("backfillOwnDispatches", () => {
  test("must-fail: reads operator_label, falling back to operator, and keeps only the surface's runs", async () => {
    await app.request("/api/mine");
    const deadline = Date.now() + 5_000;
    while (listOwnDispatches(50).length < 2 && Date.now() < deadline) await Bun.sleep(20);
    expect(listOwnDispatches(50).map((r) => r.dispatchId).sort()).toEqual(["new-1", "old-1"]);
  });
});
