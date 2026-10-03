/**
 * Blind calibration grading. A run is gradable only through an attested, open
 * `calibrationWindow` row from this substrate's own standing pool, and a grade
 * reaches the system only when that row's sink says "system" — then always as a
 * `purpose:"calibration"` label, which goal-host and every credit reader skip.
 */
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { corpusVerdict, isOwnSubstrate, parseWindow } from "../src/calibration.ts";
import { proxyRouter } from "../src/routes/proxy.ts";

const NOW = Date.parse("2026-10-03T20:00:00Z");

function row(body: Record<string, unknown>, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "pool-1",
    shape: "calibrationWindow",
    status: "open",
    attested: { by: "operator", key_id: "k", at: "2026-10-03T19:00:00Z" },
    body: {
      window_id: "w1",
      sample_draw_id: "d1",
      seed: "s",
      dispatch_ids: ["run-a", "run-b"],
      declared_at: "2026-10-03T19:00:00Z",
      closes_at: "2026-10-04T19:00:00Z",
      ...body,
    },
    ...extra,
  };
}

describe("parseWindow", () => {
  test("an attested open window in its time range is usable, with the report sink by default", () => {
    const p = parseWindow(row({}), NOW);
    expect(p.ok).toBe(true);
    if (p.ok) {
      expect(p.window.dispatchIds).toEqual(["run-a", "run-b"]);
      expect(p.window.labelSink).toBe("report");
    }
  });

  test("must-fail: an unattested row is not a window", () => {
    expect(parseWindow(row({}, { attested: undefined }), NOW)).toEqual({ ok: false, reason: "unattested" });
    expect(parseWindow(row({}, { attested: { by: "node" } }), NOW)).toEqual({ ok: false, reason: "unattested" });
  });

  test("must-fail: an attestation inside the body (caller-supplied) does not count", () => {
    const forged = row({ attested: { by: "operator" } }, { attested: undefined });
    expect(parseWindow(forged, NOW).ok).toBe(false);
  });

  test("must-fail: closed, not yet declared, retired, empty or unknown-sink windows are unavailable", () => {
    expect(parseWindow(row({ closes_at: "2026-10-03T19:30:00Z" }), NOW)).toEqual({ ok: false, reason: "closed" });
    expect(parseWindow(row({ declared_at: "2026-10-03T21:00:00Z" }), NOW)).toEqual({ ok: false, reason: "not yet declared" });
    expect(parseWindow(row({}, { status: "retired" }), NOW).ok).toBe(false);
    expect(parseWindow(row({ dispatch_ids: [] }), NOW)).toEqual({ ok: false, reason: "no dispatch_ids" });
    expect(parseWindow(row({ label_sink: "anywhere" }), NOW)).toEqual({ ok: false, reason: "unknown label_sink" });
  });

  test("grades map onto the corpus verdict vocabulary", () => {
    expect(corpusVerdict("reached")).toBe("achieved");
    expect(corpusVerdict("partial")).toBe("partial");
    expect(corpusVerdict("not_reached")).toBe("not_achieved");
  });

  test("only this substrate's own pool may declare a window", () => {
    expect(isOwnSubstrate("http://127.0.0.1:8090")).toBe(true);
    expect(isOwnSubstrate("https://peer.example:8090")).toBe(false);
  });
});

// ── routes, against a stub fleet ─────────────────────────────────────────────

let poolRows: unknown[] = [];
let vessels: Array<Record<string, unknown>> = [];
const labelWrites: Record<string, unknown>[] = [];
const poolReadsFrom: string[] = [];

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(String(init?.body ?? "")) as Record<string, unknown>;
  } catch {
    /* not json */
  }
  const pointer = ((parsed["impulse"] as { pointer?: Record<string, unknown> } | undefined)?.pointer ??
    parsed["pointer"] ??
    parsed) as Record<string, unknown>;
  if (pointer["type"] === "vesselCapability") {
    return new Response(JSON.stringify({ content: { vessels } }), { status: 200 });
  }
  if (pointer["type"] === "poolImpulse") {
    poolReadsFrom.push(url);
    return new Response(JSON.stringify({ success: true, shape: "poolImpulse", body: { impulses: poolRows, count: poolRows.length } }), { status: 200 });
  }
  if (pointer["type"] === "goal_verification_label_write") {
    labelWrites.push(pointer);
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  }
  if (pointer["type"] === "goalWalkState" || parsed["type"] === "goalWalkState") {
    return new Response(JSON.stringify({ resolved: true, body: { dispatchId: "run-a", executionId: "exec_a", goal: "a goal" } }), { status: 200 });
  }
  return new Response(JSON.stringify({ resolved: true, body: {} }), { status: 200 });
}) as typeof fetch;

afterAll(() => {
  globalThis.fetch = realFetch;
});

beforeEach(() => {
  labelWrites.length = 0;
  poolReadsFrom.length = 0;
  vessels = [{ endpoint: "http://127.0.0.1:8090", resolve_endpoint: "/v2/impulses/resolve" }];
  const now = Date.now();
  poolRows = [
    row({
      declared_at: new Date(now - 60_000).toISOString(),
      closes_at: new Date(now + 3_600_000).toISOString(),
    }),
  ];
});

const app = new Hono();
app.route("/", proxyRouter);

function grade(body: Record<string, unknown>): Promise<Response> {
  return app.request("/api/calibration/grade", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function withSink(sink: string): void {
  const now = Date.now();
  poolRows = [
    row({
      label_sink: sink,
      declared_at: new Date(now - 60_000).toISOString(),
      closes_at: new Date(now + 3_600_000).toISOString(),
    }),
  ];
}

describe("/api/calibration/windows", () => {
  test("lists an attested open window from this substrate's pool", async () => {
    const res = await app.request("/api/calibration/windows");
    const j = (await res.json()) as { windows: Array<{ window_id: string; dispatch_ids: string[] }>; reason: string | null };
    expect(j.windows.map((w) => w.window_id)).toEqual(["w1"]);
    expect(j.windows[0]?.dispatch_ids).toEqual(["run-a", "run-b"]);
    expect(j.reason).toBeNull();
  });

  test("must-fail: a peer's pool is never read, so its windows never appear", async () => {
    vessels = [{ endpoint: "https://peer.example", resolve_endpoint: "/v2/impulses/resolve" }];
    const j = (await (await app.request("/api/calibration/windows")).json()) as { windows: unknown[]; reason: string };
    expect(j.windows).toEqual([]);
    expect(j.reason).toBe("no producer");
    expect(poolReadsFrom).toEqual([]);
  });

  test("must-fail: an unattested row leaves calibration unavailable, with the reason", async () => {
    poolRows = [row({}, { attested: undefined })];
    const j = (await (await app.request("/api/calibration/windows")).json()) as { windows: unknown[]; reason: string };
    expect(j.windows).toEqual([]);
    expect(j.reason).toBe("unattested");
  });
});

describe("/api/calibration/grade", () => {
  test("must-fail: with the default report sink nothing is written to the system", async () => {
    const res = await grade({ window_id: "w1", dispatch_id: "run-a", grade: "reached" });
    expect(res.status).toBe(409);
    expect(labelWrites).toEqual([]);
  });

  test("must-fail: a run outside the sample is refused", async () => {
    withSink("system");
    const res = await grade({ window_id: "w1", dispatch_id: "run-z", grade: "reached" });
    expect(res.status).toBe(403);
    expect(labelWrites).toEqual([]);
  });

  test("must-fail: an unknown or unattested window is refused", async () => {
    withSink("system");
    expect((await grade({ window_id: "w9", dispatch_id: "run-a", grade: "reached" })).status).toBe(404);
    poolRows = [row({ label_sink: "system" }, { attested: undefined })];
    expect((await grade({ window_id: "w1", dispatch_id: "run-a", grade: "reached" })).status).toBe(404);
    expect(labelWrites).toEqual([]);
  });

  test("with the system sink, the label always carries purpose:calibration and the window", async () => {
    withSink("system");
    const res = await grade({ window_id: "w1", dispatch_id: "run-a", grade: "partial", notes: " missing the chart " });
    expect(res.status).toBe(200);
    expect(labelWrites.length).toBe(1);
    const l = labelWrites[0] as Record<string, unknown>;
    expect(l["purpose"]).toBe("calibration");
    expect(l["window_id"]).toBe("w1");
    expect(l["sample_draw_id"]).toBe("d1");
    expect(l["labeler"]).toBe("human");
    expect(l["verdict"]).toBe("partial");
    expect(l["execution_id"]).toBe("exec_a");
    expect(l["notes"]).toBe("missing the chart");
  });

  test("a grade outside the vocabulary is refused", async () => {
    withSink("system");
    expect((await grade({ window_id: "w1", dispatch_id: "run-a", grade: "achieved" })).status).toBe(400);
    expect(labelWrites).toEqual([]);
  });
});
