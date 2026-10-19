/**
 * A box message read as a decline or a request for more (16f-2) is kept with how
 * it was read: classified_by and the phrase it matched, on the question's record,
 * so a misread is attributable in the record rather than inferred later.
 */
import { describe, expect, test } from "bun:test";
import { participationRouter } from "../src/routes/participation.ts";
import { impulsesRouter } from "../src/routes/impulses.ts";

async function question(id: string): Promise<number> {
  const r = await impulsesRouter.request("/v2/impulses/resolve", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pointer: { type: "uiQuestion_write", id, title: "Where should it look?", body: "## Where should it look?" } }),
  });
  expect(r.status).toBe(200);
  const read = await participationRouter.request("/api/questions");
  const q = ((await read.json()) as { body: { questions: { id: string; revision: number }[] } }).body.questions.find((x) => x.id === id)!;
  return q.revision;
}

async function contribute(body: Record<string, unknown>) {
  const r = await participationRouter.request("/api/participation", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, json: (await r.json()) as { body?: Record<string, unknown> } };
}

describe("a reply read from the box's words", () => {
  test("must-fail: a decline read from \"not now\" keeps classified_by and the phrase", async () => {
    const revision = await question("q-classified");
    const r = await contribute({ panel_id: "q-classified", panel_revision: revision, response_id: "r-not-now", kind: "dismiss", value: "declined", classified_by: "box-phrase", classified_phrase: "not now" });
    expect(r.status).toBe(200);
    expect(r.json.body).toMatchObject({ kind: "dismiss", value: "declined", classifiedBy: { by: "box-phrase", phrase: "not now" } });
  });

  test("an answer carries no classification, and a malformed one is not kept", async () => {
    const revision = await question("q-plain");
    const plain = await contribute({ panel_id: "q-plain", panel_revision: revision, response_id: "r-plain", kind: "answer", value: "Seattle" });
    expect(plain.json.body?.["classifiedBy"]).toBeUndefined();
    const odd = await contribute({ panel_id: "q-plain", panel_revision: revision, response_id: "r-odd", kind: "dismiss", value: "declined", classified_by: 7 });
    expect(odd.json.body?.["classifiedBy"]).toBeUndefined();
  });
});
