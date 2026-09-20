import { describe, expect, test } from "bun:test";
import { impulsesRouter } from "../src/routes/impulses.ts";
import { listPanels, questionView } from "../src/store.ts";

/**
 * The accept-guard in store.ts `recordFeedback`.
 *
 * The defect this file clamps: the three-way refusal split (missing panel /
 * informational panel / revision mismatch) plus the ask-id validity check were
 * all nested inside `if (f.panelRevision !== undefined)`. A `uiFeedback` that
 * simply OMITS `panel_revision` therefore skipped every check, and a bogus ask
 * id was accepted, stored, and admitted into the current-revision `answers`
 * set that `questionView` uses as its completion oracle.
 *
 * Feedback is submitted through the SHAPED route here, not through
 * /api/participation: the browser adapter (routes/participation.ts:20) rejects
 * a missing `panel_revision` with a 400 of its own, so it cannot reach — and
 * therefore cannot exercise — the guard under test. The shaped route is the
 * path the substrate's own resolvers use, and the path the bypass was observed
 * on (validation/human-participation/asks-contract-probe.ts).
 */

async function resolve(pointer: Record<string, unknown>) {
  return impulsesRouter.request("/v2/impulses/resolve", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pointer }),
  });
}

async function panelWithAsks(type: "uiQuestion_write" | "uiPanel_write", extras: Record<string, unknown> = {}) {
  const id = crypto.randomUUID();
  const response = await resolve({ type, id, title: "Review the evidence", body: "Which?", ...extras });
  expect(response.status).toBe(200);
  return (await response.json()).body as { id: string; revision: number; kind: string };
}

/** Submit uiFeedback with FULL control over whether panel_revision is present. */
async function feedback(pointer: Record<string, unknown>) {
  const response = await resolve({ type: "uiFeedback", kind: "answer", value: "x", response_id: crypto.randomUUID(), ...pointer });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

const ASKS = [{ id: "cause", prompt: "Cause?", type: "text" }, { id: "fix", prompt: "Fix?", type: "text" }];
const view = (id: string) => questionView(listPanels().find(p => p.id === id)!);

describe("accept guard: checks that do not need a revision must not be gated on one", () => {
  test("a bogus ask id with NO panel_revision is refused and never enters the answers set", async () => {
    const panel = await panelWithAsks("uiQuestion_write", { asks: ASKS });
    expect((await feedback({ panel_id: panel.id, ask_id: "cause" })).status).toBe(200);

    const bogus = await feedback({ panel_id: panel.id, ask_id: "part-does-not-exist" });
    expect(bogus.status).toBe(409);
    expect(String(bogus.body.error)).toBe("This question no longer contains the requested part.");

    // The phantom answer must not be admitted into the completion oracle's input.
    const after = view(panel.id);
    expect(after.answers.map(a => a.askId).sort()).toEqual(["cause"]);
    expect(after.responses).toHaveLength(1);
    // `answered` is still false here because "fix" is genuinely unanswered.
    // NOTE (what this assertion CANNOT cover): a bogus ask id cannot by itself
    // flip `answered` false→true in this oracle, since `answered` requires
    // every REAL ask id to be matched. The live observation of `answered=true`
    // alongside a stored "part-does-not-exist" had prior valid answers already
    // covering the asks. So the discriminating evidence for the bypass is the
    // 200-vs-409 and the phantom row in `answers`, not the `answered` flag.
    expect(after.answered).toBe(false);
  });

  test("an informational panel solicits nothing whether or not a revision is asserted", async () => {
    const info = await panelWithAsks("uiPanel_write", { asks: ASKS });
    expect(info.kind).toBe("info");
    const message = "That panel is informational — nothing is being asked of you there, so there is nothing to respond to. Your draft has not been applied.";

    // Positive control (passes before AND after the fix): revision asserted.
    const withRevision = await feedback({ panel_id: info.id, panel_revision: info.revision, ask_id: "cause" });
    expect(withRevision.status).toBe(409);
    expect(String(withRevision.body.error)).toBe(message);

    // Red before / green after: no revision asserted.
    const withoutRevision = await feedback({ panel_id: info.id, ask_id: "cause" });
    expect(withoutRevision.status).toBe(409);
    expect(String(withoutRevision.body.error)).toBe(message);
  });

  // REGRESSION CLAMP — this test is the point of the file. The ask-id refusal
  // must hold in BOTH the with-revision and the without-revision case, so
  // re-nesting the ask-id branch inside `if (f.panelRevision !== undefined)`
  // fails here even though every other assertion in the suite would still pass.
  test("the ask-id refusal holds identically with and without a revision", async () => {
    const panel = await panelWithAsks("uiQuestion_write", { asks: ASKS });
    const withRevision = await feedback({ panel_id: panel.id, panel_revision: panel.revision, ask_id: "nope" });
    const withoutRevision = await feedback({ panel_id: panel.id, ask_id: "nope" });
    expect([withRevision.status, withoutRevision.status]).toEqual([409, 409]);
    expect(String(withoutRevision.body.error)).toBe(String(withRevision.body.error));
    expect(view(panel.id).responses).toHaveLength(0);
  });
});

describe("accept guard: positive controls that must pass before and after", () => {
  test("a valid ask id with no revision is still accepted", async () => {
    const panel = await panelWithAsks("uiQuestion_write", { asks: ASKS });
    const accepted = await feedback({ panel_id: panel.id, ask_id: "fix" });
    expect(accepted.status).toBe(200);
    expect(view(panel.id).answers.map(a => a.askId)).toEqual(["fix"]);
  });

  test("a valid ask id with the correct revision is accepted", async () => {
    const panel = await panelWithAsks("uiQuestion_write", { asks: ASKS });
    const accepted = await feedback({ panel_id: panel.id, panel_revision: panel.revision, ask_id: "cause" });
    expect(accepted.status).toBe(200);
    expect(view(panel.id).answers.map(a => a.askId)).toEqual(["cause"]);
  });

  test("a whole-panel answer with no ask id and no revision is accepted", async () => {
    const panel = await panelWithAsks("uiQuestion_write", { asks: ASKS });
    expect((await feedback({ panel_id: panel.id })).status).toBe(200);
    expect(view(panel.id).answered).toBe(true);
  });

  // The cross-vessel / legacy path. This store holds 0 panels in deployment
  // while the live panel corpus lives in another vessel, so feedback about a
  // panel this store does not know is LEGITIMATE — provided no revision was
  // asserted. Refusing it would be a new bug, not a fix.
  test("feedback about a panel unknown to this store, with no revision, is accepted", async () => {
    const accepted = await feedback({ panel_id: "panel-owned-by-another-vessel", ask_id: "any-part-at-all" });
    expect(accepted.status).toBe(200);
    expect(typeof accepted.body.body).toBe("object");
  });

  test("a revision asserted against a panel this store does not hold is still refused", async () => {
    const refused = await feedback({ panel_id: "panel-owned-by-another-vessel", panel_revision: 3 });
    expect(refused.status).toBe(409);
    expect(String(refused.body.error))
      .toBe("That question is no longer available on this surface. Your draft has not been applied.");
  });

  test("a stale revision on a known panel is still refused", async () => {
    const panel = await panelWithAsks("uiQuestion_write", { asks: ASKS });
    await resolve({ type: "uiQuestion_write", id: panel.id, title: "Revised", body: "New evidence" });
    const refused = await feedback({ panel_id: panel.id, panel_revision: panel.revision, ask_id: "cause" });
    expect(refused.status).toBe(409);
    expect(String(refused.body.error))
      .toBe("The question changed since you loaded it. Review the current version before responding; your draft has not been applied.");
  });
});
