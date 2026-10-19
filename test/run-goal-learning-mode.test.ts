/**
 * A probe sent through the surface runs in the mode it asks for: /api/run-goal
 * forwards a top-level learning_mode to goal-host as given, and adds none when
 * the client set none (a person's ask learns). Before goal-host read it on the
 * async path, an "observe" probe sent here ran as a learning run.
 */
import { describe, expect, test } from "bun:test";
import { Hono } from "hono";

const dispatched: Record<string, unknown>[] = [];
globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
  const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown> & { pointer?: { type?: string } };
  const type = String(body["type"] ?? body.pointer?.type ?? "");
  if (type === "vesselCapability") return new Response(JSON.stringify({ content: { vessels: [] } }), { status: 200 });
  if (type === "goalDispatchAsync") {
    dispatched.push(body);
    return new Response(JSON.stringify({ dispatchId: `d-${dispatched.length}`, status: "running" }), { status: 202 });
  }
  return new Response("{}", { status: 200 });
}) as typeof fetch;

const { proxyRouter } = await import("../src/routes/proxy.ts");
const app = new Hono();
app.route("/", proxyRouter);

const post = (body: Record<string, unknown>) =>
  app.request("/api/run-goal", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });

describe("/api/run-goal and learning_mode", () => {
  test("an observe probe reaches goal-host with learning_mode observe, at the top level goal-host reads", async () => {
    const r = await post({ goal: "What is 2 + 2?", operator: "human-surface", tags: ["probe:x"], learning_mode: "observe" });
    expect(r.status).toBe(202);
    expect(dispatched.at(-1)).toMatchObject({ type: "goalDispatchAsync", goal: "What is 2 + 2?", learning_mode: "observe" });
  });

  test("a person's ask carries no learning_mode the client didn't set", async () => {
    await post({ goal: "What time is it?", operator: "human-surface" });
    expect(dispatched.at(-1)).not.toHaveProperty("learning_mode");
  });
});
