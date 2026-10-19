import { Hono } from "hono";
import { impulsesRouter } from "./impulses.ts";
import { admittedCaller, carry, requireCaller, type Caller } from "../inbound-auth.ts";

/** Browser adapter for the existing shapes. No private question/answer store. */
export const participationRouter = new Hono();

/** In process; a write carries the caller this route admitted (inbound-auth.ts `carry`). */
async function resolve(pointer: Record<string, unknown>, caller?: Caller): Promise<Response> {
  return impulsesRouter.request("/v2/impulses/resolve", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ pointer }),
  }, caller ? carry(caller) : undefined);
}

participationRouter.get("/api/questions", () => resolve({ type: "uiQuestion" }));

/** A reply is a sentence or a short paste; the cap bounds what one contribution adds to the journal. */
export const PARTICIPATION_MAX_VALUE_CHARS = 20_000;

participationRouter.post("/api/participation", requireCaller("/api/participation"), async c => {
  const body = await c.req.json().catch(() => null) as Record<string, unknown> | null;
  if (body && Object.hasOwn(body, "value") && (JSON.stringify(body.value) ?? "").length > PARTICIPATION_MAX_VALUE_CHARS) {
    return c.json({ error: "too long" }, 413);
  }
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
    // How the box read a reply, when it read one from its words (16f-2); strings only.
    ...(typeof body.classified_by === "string" && typeof body.classified_phrase === "string"
      ? { classified_by: body.classified_by, classified_phrase: body.classified_phrase }
      : {}),
    visibility: "public",
  }, admittedCaller(c));
});
