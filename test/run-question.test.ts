/**
 * A run asking its human (goal-host WS5 `human_input`) is stored as a question
 * carrying its run — linked to the run only after the surface READS the run's
 * walk state, because this vessel's write routes are unauthenticated and a
 * forged dispatch id must not put a question on someone's run.
 */
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { impulsesRouter } from "../src/routes/impulses.ts";
import { getPanel } from "../src/store.ts";

const realFetch = globalThis.fetch;
let walks: Record<string, Record<string, unknown>> = {};
const walkReads: string[] = [];

globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
  const body = String(init?.body ?? "");
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(body) as Record<string, unknown>;
  } catch {
    /* not json */
  }
  if (parsed["type"] === "goalWalkState") {
    const id = String(parsed["dispatchId"]);
    walkReads.push(id);
    const w = walks[id];
    return new Response(JSON.stringify(w ? { resolved: true, shape: "goalWalkState", body: w } : { resolved: false }), {
      status: w ? 200 : 404,
    });
  }
  // Discovery and probes: answer as a goal host would, so the proxy picks a candidate.
  return new Response(JSON.stringify({ resolved: true, body: {} }), { status: 200 });
}) as typeof fetch;

afterAll(() => {
  globalThis.fetch = realFetch;
});

beforeEach(() => {
  walks = {};
  walkReads.length = 0;
});

const app = new Hono();
app.route("/", impulsesRouter);

async function ask(pointer: Record<string, unknown>): Promise<{ status: number; json: Record<string, unknown> }> {
  // The exact envelope goal-host's solicitHumanInput posts.
  const res = await app.request("/v2/impulses/resolve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "human_input", pointer: { type: "human_input", ...pointer } }),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

const brief = "## The substrate needs your input\n\n**Goal**\n\n> What is happening today?";

describe("human_input", () => {
  test("a run that is running and waiting gets its question linked", async () => {
    walks["d-run"] = { dispatchId: "d-run", status: "running" };
    const r = await ask({ solicitation_id: "s-1", dispatch_id: "d-run", question_markdown: brief, timeout_ms: 120_000 });
    expect(r.status).toBe(200);
    expect((r.json["body"] as Record<string, unknown>)["linked"]).toBe(true);
    const panel = getPanel("solicitation-s-1");
    expect(panel?.kind).toBe("question");
    expect(panel?.body).toBe(brief);
    expect(panel?.run?.dispatchId).toBe("d-run");
    expect(panel?.run?.linked).toBe(true);
    expect(typeof panel?.run?.deadlineAt).toBe("number");
    expect(walkReads).toEqual(["d-run"]);
  });

  test("must-fail: a dispatch goal-host does not know is stored unlinked", async () => {
    const r = await ask({ solicitation_id: "s-2", dispatch_id: "d-forged", question_markdown: brief });
    expect((r.json["body"] as Record<string, unknown>)["linked"]).toBe(false);
    expect(getPanel("solicitation-s-2")?.run?.linked).toBe(false);
  });

  test("must-fail: a finished run is not linked", async () => {
    walks["d-done"] = { dispatchId: "d-done", status: "failed" };
    const r = await ask({ solicitation_id: "s-3", dispatch_id: "d-done", question_markdown: brief });
    expect((r.json["body"] as Record<string, unknown>)["linked"]).toBe(false);
  });

  test("must-fail: when goal-host reports a different pending solicitation, not linked", async () => {
    walks["d-other"] = { dispatchId: "d-other", status: "running", pendingSolicitation: { solicitationId: "s-someone-else" } };
    const r = await ask({ solicitation_id: "s-4", dispatch_id: "d-other", question_markdown: brief });
    expect((r.json["body"] as Record<string, unknown>)["linked"]).toBe(false);
  });

  test("the shaped-brief contract: brief and deadline_at are carried as given", async () => {
    walks["d-brief"] = { dispatchId: "d-brief", status: "running", pendingSolicitation: { solicitationId: "s-5" } };
    const shaped = { shape: "question_brief", needed: "a source for the claim", tried: ["web_search"] };
    await ask({ solicitation_id: "s-5", dispatch_id: "d-brief", brief: shaped, deadline_at: 1_900_000_000_000 });
    const panel = getPanel("solicitation-s-5");
    expect(panel?.body).toEqual(shaped);
    expect(panel?.run?.deadlineAt).toBe(1_900_000_000_000);
    expect(panel?.run?.linked).toBe(true);
  });

  test("a solicitation id is required", async () => {
    const r = await ask({ dispatch_id: "d-run", question_markdown: brief });
    expect(r.status).toBe(400);
  });
});
