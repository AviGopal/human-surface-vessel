import { Hono } from "hono";
import { impulsesRouter } from "./impulses.ts";

/** Browser adapter for the existing shapes. No private question/answer store. */
export const participationRouter = new Hono();

async function resolve(pointer: Record<string, unknown>): Promise<Response> {
  return impulsesRouter.request("/v2/impulses/resolve", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ pointer }),
  });
}

participationRouter.get("/api/questions", () => resolve({ type: "uiQuestion" }));

participationRouter.post("/api/participation", async c => {
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body.panel_id !== "string" || !body.panel_id ||
      typeof body.response_id !== "string" || !body.response_id ||
      typeof body.panel_revision !== "number" || !Number.isInteger(body.panel_revision) || body.panel_revision < 1 ||
      !["answer", "dismiss"].includes(String(body.kind)) || !Object.hasOwn(body, "value") ||
      (body.ask_id !== undefined && typeof body.ask_id !== "string")) {
    return c.json({ error: "Question id, revision, response id, answer/dismiss kind and value are required." }, 400);
  }
  return resolve({
    type: "uiFeedback", panel_id: body.panel_id, panel_revision: body.panel_revision,
    response_id: body.response_id, ask_id: body.ask_id, kind: body.kind, value: body.value,
    visibility: "public",
  });
});
