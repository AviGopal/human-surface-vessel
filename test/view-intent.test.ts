/**
 * The box reads a presentation phrase only when the whole ask is one, and only
 * about the output on screen (16f-1, user ruling 10-19: "Show as" retires and the
 * box carries it). Anything else is a goal and goes to the walk.
 *
 * Shapes: one node 10-18, the typed "Render apnews.com as a webpage." was read as
 * a display instruction and pinned formByShape {"apnews.com": "page"}, a key no
 * shape will ever match; the ask itself never ran.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { proxyRouter } from "../src/routes/proxy.ts";
import { getRenderPolicy, recentObservations } from "../src/store.ts";
import { readViewIntent } from "../src/surface-intent.ts";

const REGISTRY = ["shellResult", "webSearchResult", "http_fetch", "llmCompletion"];
let registryUp = true;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = String(input);
  if (url.endsWith("/registry/shapes")) {
    return registryUp ? new Response(JSON.stringify({ shapes: REGISTRY }), { status: 200 }) : new Response("{}", { status: 503 });
  }
  return new Response("{}", { status: 404 });
}) as typeof fetch;
afterAll(() => {
  globalThis.fetch = realFetch;
});

const app = new Hono();
app.route("/", proxyRouter);

const prose = { shape: "webSearchResult", form: "prose", markup: false, region: "answer" };
const markup = { shape: "http_fetch", form: "text", markup: true, region: "answer" };

async function say(instruction: string, onScreen: unknown) {
  const res = await app.request("/api/surface-intent", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ instruction, onScreen }),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

function refusalsFor(text: string) {
  return recentObservations(500).filter((o) => o.type === ("surface_intent_refused" as never) && (o.body as { text?: string } | undefined)?.text === text);
}

describe("the box's presentation reading", () => {
  test("must-fail (F1): a sentence naming something else is a goal, never a display rule", async () => {
    for (const onScreen of [null, markup]) {
      const before = getRenderPolicy();
      const r = await say("Render apnews.com as a webpage.", onScreen);
      expect(r.status).toBe(422);
      expect(getRenderPolicy().formByShape["apnews.com"]).toBeUndefined();
      expect(getRenderPolicy().revision).toBe(before.revision);
      expect(r.body["view"]).toBeUndefined();
    }
    expect(refusalsFor("Render apnews.com as a webpage.")).toEqual([]);
  });

  test("must-fail (F2): \"show this as a table\" changes the view of what is on screen, and writes no policy", async () => {
    const before = getRenderPolicy().revision;
    const r = await say("show this as a table", prose);
    expect(r.status).toBe(200);
    expect(r.body["view"]).toEqual({ shape: "webSearchResult", form: "rows", region: "answer" });
    expect(r.body["applied"]).toBe(false);
    expect(getRenderPolicy().revision).toBe(before);
    const bare = await say("as text", markup);
    expect(bare.body["view"]).toEqual({ shape: "http_fetch", form: "text", region: "answer" });
  });

  test("must-fail (F4): a phrase the screen can't take is refused, and the refusal is kept", async () => {
    const before = getRenderPolicy().revision;
    const page = await say("show this as a page", prose);
    expect(page.status).toBe(200);
    expect(page.body["view"]).toBeUndefined();
    expect(typeof (page.body["refused"] as { reason?: unknown })?.reason).toBe("string");
    const kept = refusalsFor("show this as a page");
    expect(kept.length).toBe(1);
    expect(kept[0]!.body).toMatchObject({ origin: "box", region: "answer", shape: "webSearchResult" });
    const nothing = await say("as a table", null);
    expect(nothing.status).toBe(200);
    expect(nothing.body["refused"]).toBeDefined();
    expect(refusalsFor("as a table").length).toBe(1);
    expect(getRenderPolicy().revision).toBe(before);
  });

  test("F8: an ask that merely ends in a form is a goal", async () => {
    const before = getRenderPolicy().revision;
    const r = await say("List the five largest cities as a table", prose);
    expect(r.status).toBe(422);
    expect(r.body["view"]).toBeUndefined();
    expect(refusalsFor("List the five largest cities as a table")).toEqual([]);
    expect(getRenderPolicy().revision).toBe(before);
  });

  test("F9: \"explain this\" names the screen but no form: a goal", async () => {
    const r = await say("explain this", prose);
    expect(r.status).toBe(422);
    expect(r.body["view"]).toBeUndefined();
  });

  test("must-fail: a long view-shaped input is read in linear time, and the route caps what it reads", async () => {
    // A lazy capture before a trailing [\s.!]*$ backtracked over every trailing run
    // that ends in anything else: 20k chars took ~0.4 s, 50k ~2 s, synchronously,
    // on the surface's event loop.
    for (const tail of [". ".repeat(50_000), " .".repeat(50_000), ".".repeat(100_000)]) {
      const t0 = performance.now();
      expect(readViewIntent(`show this as table${tail}x`, prose)).toBeNull();
      expect(performance.now() - t0).toBeLessThan(50);
    }
    // A short ask with trailing punctuation still reads.
    expect(readViewIntent("show this as a table!!  ..", prose)).toMatchObject({ kind: "view", form: "rows" });
    const before = getRenderPolicy().revision;
    const long = await say(`show this as table${" ".repeat(5_000)}`, prose);
    expect(long.status).toBe(413);
    expect(long.body["view"]).toBeUndefined();
    expect(getRenderPolicy().revision).toBe(before);
  });

  test("a named shape pins only when the registry has it, and fails closed when the registry can't be read", async () => {
    const pinned = await say("show shellResult as rows", null);
    expect(pinned.status).toBe(200);
    expect(getRenderPolicy().formByShape["shellResult"]).toBe("rows");
    registryUp = false;
    try {
      const unread = await say("show llmCompletion as text", null);
      expect(unread.status).toBe(422);
      expect(getRenderPolicy().formByShape["llmCompletion"]).toBeUndefined();
    } finally {
      registryUp = true;
    }
  });
});
