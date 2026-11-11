/**
 * A walk step asking its human (`human_input`, which this surface serves) is stored as a
 * question. It is never linked to a run: the run model it was linked through went with
 * goal-host, and storing the question reads nothing from any other vessel.
 */
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { testAuth } from "./setup.ts";
import { Hono } from "hono";
import { impulsesRouter } from "../src/routes/impulses.ts";
import { getPanel } from "../src/store.ts";

const realFetch = globalThis.fetch;
const outbound: string[] = [];

globalThis.fetch = (async (input: RequestInfo | URL) => {
  outbound.push(String(input));
  return new Response(JSON.stringify({ resolved: true, body: {} }), { status: 200 });
}) as typeof fetch;

afterAll(() => {
  globalThis.fetch = realFetch;
});

beforeEach(() => {
  outbound.length = 0;
});

const app = new Hono();
app.route("/", impulsesRouter);

async function ask(pointer: Record<string, unknown>): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await app.request("/v2/impulses/resolve", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...testAuth() },
    body: JSON.stringify({ type: "human_input", pointer: { type: "human_input", ...pointer } }),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

const brief = "## The substrate needs your input\n\n**Goal**\n\n> What is happening today?";

describe("human_input", () => {
  test("a question is stored with its brief and deadline, and is not linked to any run", async () => {
    const r = await ask({ solicitation_id: "s-1", dispatch_id: "d-run", question_markdown: brief, timeout_ms: 120_000 });
    expect(r.status).toBe(200);
    expect((r.json["body"] as Record<string, unknown>)["linked"]).toBe(false);
    const panel = getPanel("solicitation-s-1");
    expect(panel?.kind).toBe("question");
    expect(panel?.body).toBe(brief);
    expect(panel?.run?.linked).toBe(false);
    expect(typeof panel?.run?.deadlineAt).toBe("number");
  });

  test("must-fail: storing a question reads nothing from any other vessel", async () => {
    await ask({ solicitation_id: "s-2", dispatch_id: "d-any", question_markdown: brief });
    expect(outbound).toEqual([]);
  });

  test("the shaped-brief contract: brief and deadline_at are carried as given", async () => {
    const shaped = { shape: "question_brief", needed: "a source for the claim", tried: ["web_search"] };
    await ask({ solicitation_id: "s-5", dispatch_id: "d-brief", brief: shaped, deadline_at: 1_900_000_000_000 });
    const panel = getPanel("solicitation-s-5");
    expect(panel?.body).toEqual(shaped);
    expect(panel?.run?.deadlineAt).toBe(1_900_000_000_000);
  });

  test("a solicitation id is required", async () => {
    const r = await ask({ dispatch_id: "d-run", question_markdown: brief });
    expect(r.status).toBe(400);
  });
});
