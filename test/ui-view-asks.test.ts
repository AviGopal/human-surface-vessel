/**
 * `human_surface:ui_view` carries the questions rail as a person meets it, per
 * kind: how it is presented, who reads the answers, and the malformed asks a
 * writer sent. It is served by shape and advertised, so a question writer can
 * read it before it asks.
 */
import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { DISCOVERY_SHAPES } from "../src/config.ts";
import { impulsesRouter } from "../src/routes/impulses.ts";
import { upsertPanel } from "../src/store.ts";
import { buildAsksView } from "../src/ui-view.ts";

upsertPanel({ id: "needs-human-g1", title: "Gap needs a human decision", body: "Gap g1 (x) failed. Summary: s", kind: "uiv_escalation", importance: "high" });
upsertPanel({ id: "pending-verify-g2", title: "Did it fix it?", body: "Gap g2 (x) landed. Summary: s", kind: "uiv_verify", importance: "medium" });
upsertPanel({ id: "pending-verify-g3", title: "Did it fix it?", body: "Gap g3 (x) landed. Summary: s", kind: "uiv_verify", importance: "medium" });
upsertPanel({ id: "uiv-panel-empty", title: "Remove 'continue' statement", body: "", kind: "uiv_change", importance: "high", asks: [] });
upsertPanel({ id: "{{goal.id}}", title: "{{goal.title}}", body: "How are you?", kind: "{{goal.kind}}", importance: "medium" });

describe("buildAsksView", () => {
  // Every malformed write, not the newest five: other test files share this store.
  const view = buildAsksView(Number.POSITIVE_INFINITY);
  const kind = (k: string) => view.by_kind.find((r) => r.kind === k);

  test("counts each kind as the rail presents it, with its answer reader", () => {
    expect(kind("uiv_verify")).toMatchObject({ count: 2, open: 2, presented_as: { unread: 2 }, answer_readers: { pending_verification: 2 } });
    expect(kind("uiv_escalation")).toMatchObject({ count: 1, presented_as: { ask: 1 }, answer_readers: { escalation: 1 } });
  });

  test("must-fail: malformed writes are named with their reason and are not open asks", () => {
    const named = new Map(view.malformed.map((m) => [m.id, m.reason] as const));
    expect(named.get("uiv-panel-empty")).toBe("empty");
    expect(named.get("{{goal.id}}")).toBe("unrendered_template");
    expect(kind("uiv_change")).toMatchObject({ count: 1, presented_as: { malformed: 1 } });
    const asks = view.by_kind.reduce((n, r) => n + (r.presented_as.ask ?? 0), 0);
    expect(view.open_asks).toBeLessThanOrEqual(asks);
  });
});

describe("served by shape", () => {
  const app = new Hono();
  app.route("/", impulsesRouter);

  test("advertised, and resolvable at the fleet's resolve path", async () => {
    expect(DISCOVERY_SHAPES).toContain("human_surface:ui_view");
    const res = await app.request("/v2/impulses/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "human_surface:ui_view", pointer: { type: "human_surface:ui_view" } }),
    });
    expect(res.status).toBe(200);
    const j = (await res.json()) as { shape: string; body: { asks: { open_asks: number } } };
    expect(j.shape).toBe("human_surface:ui_view");
    expect(typeof j.body.asks.open_asks).toBe("number");
  });
});
