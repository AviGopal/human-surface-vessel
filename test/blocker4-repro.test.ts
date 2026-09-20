// BLOCKER-4 falsifier: a DEFAULTED uiQuestion_write destroys an existing panel's content.
// Runs against a DISPOSABLE workspace (test/setup.ts sets WORKSPACE_ROOT to a mkdtemp).
//
// Two predicates are under test, and they are one edit:
//   (1) absence preserves — an omitted field falls back to what is stored; a
//       literal default applies only on genuine creation; an EXPLICIT empty
//       value still clears.
//   (2) a contentless write over an existing panel is REFUSED (409), because
//       predicate (1) alone would make it a silent success on the old revision
//       — the walk would record a green step for a write that carried nothing.
//
// PROCESS-SHARED STORE: `../src/store.ts` is a module-level in-memory store, and
// one `bun test` process loads it ONCE for every *.test.ts file in the suite.
// Panels written by solicitation-store.test.ts / solicitation-reader.test.ts are
// therefore visible here, in whatever order bun happens to run the files. So:
// every id below carries this file's `b4r-` prefix, and every assertion is
// scoped to an id this file wrote (via `live(id)`) — NEVER a count over the
// store. Do not add `expect(listPanels()).toHaveLength(n)` or any other
// whole-store tally: it would pass today and flap the moment a sibling file is
// added, renamed, or reordered.
import { describe, expect, test } from "bun:test";
import { impulsesRouter } from "../src/routes/impulses.ts";
import { listPanels } from "../src/store.ts";

async function resolve(pointer: Record<string, unknown>) {
  const r = await impulsesRouter.request("/v2/impulses/resolve", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pointer }),
  });
  return { status: r.status, json: await r.json() as any };
}

const live = (id: string) => listPanels().find(p => p.id === id);

describe("BLOCKER 4 — defaulted satisfier write over a live panel", () => {
  test("a satisfier's defaulted uiQuestion_write erases a six-claim handoff", async () => {
    const id = "b4r-frozen-s6-incident-handoff-v1";
    const seededBody = { claims: ["c1","c2","c3","c4","c5","c6"], handoff: "incident 4471" };
    const seed = await resolve({ type: "uiQuestion_write", id, title: "S6 incident handoff",
      body: seededBody, kind: "question", importance: "high",
      asks: [{ id: "a1", prompt: "Which claim is wrong?", type: "text" }] });
    expect(seed.status).toBe(200);
    const before = seed.json.body;
    console.log("SEEDED  rev=%d title=%j bodyLen=%d asks=%d createdAt=%d",
      before.revision, before.title, JSON.stringify(before.body).length, before.asks?.length ?? 0, before.createdAt);

    // EXACTLY what the walk's ACTION-THEN-READ path issued: same id, LLM-defaulted args.
    const destructive = await resolve({ type: "uiQuestion_write", id });
    console.log("DESTRUCTIVE status=%d body=%j", destructive.status, JSON.stringify(destructive.json).slice(0, 320));

    // 409-OR-CONTENT-PRESERVED. Refusal is the intended outcome (predicate 2),
    // but the falsifier's floor is that the content survives either way: a 200
    // here would have to be a true no-op, never an erasure.
    const stored = live(id)!;
    console.log("STORE   title=%j body=%j asks=%j rev=%d", stored.title, stored.body, stored.asks, stored.revision);
    expect([200, 409]).toContain(destructive.status);
    if (destructive.status === 409) {
      expect(String(destructive.json.error)).toMatch(/contentless/i);
      // A refused write must not have touched the record at all.
      expect(stored.revision).toBe(before.revision);
    }
    expect(stored.title).toBe("S6 incident handoff");
    expect(stored.body).toEqual(seededBody);
    expect(stored.asks?.length).toBe(1);
  });

  // COMPANION (i): explicit emptiness is information, not absence.
  test("an explicit body:\"\" still CLEARS the body and bumps the revision", async () => {
    const id = "b4r-explicit-empty-body";
    const seed = await resolve({ type: "uiQuestion_write", id, title: "Has a body",
      body: { text: "something" }, kind: "question" });
    expect(seed.status).toBe(200);
    const cleared = await resolve({ type: "uiQuestion_write", id, body: "" });
    console.log("CLEARED status=%d rev=%d body=%j", cleared.status, cleared.json.body?.revision, cleared.json.body?.body);
    expect(cleared.status).toBe(200);
    const stored = live(id)!;
    expect(stored.body).toBe("");
    expect(stored.revision).toBe(seed.json.body.revision + 1);
    // ...and the omitted fields were preserved, not defaulted.
    expect(stored.title).toBe("Has a body");
    expect(stored.kind).toBe("question");
  });

  // COMPANION (ii): a partial update preserves every field it did not name.
  test("a title-only update preserves body AND asks", async () => {
    const id = "b4r-title-only-update";
    const body = { detail: "keep me" };
    const seed = await resolve({ type: "uiQuestion_write", id, title: "Original title", body,
      kind: "gap_needs_human", importance: "high",
      asks: [{ id: "a1", prompt: "keep this ask", type: "text" }] });
    expect(seed.status).toBe(200);
    // A DIFFERENT title, so the revision bump is observable through
    // upsertPanel's no-op short-circuit.
    const patched = await resolve({ type: "uiQuestion_write", id, title: "Revised title" });
    console.log("PATCHED status=%d rev=%d title=%j body=%j asks=%d",
      patched.status, patched.json.body?.revision, patched.json.body?.title,
      patched.json.body?.body, patched.json.body?.asks?.length ?? 0);
    expect(patched.status).toBe(200);
    const stored = live(id)!;
    expect(stored.title).toBe("Revised title");
    expect(stored.body).toEqual(body);
    expect(stored.asks?.length).toBe(1);
    expect(stored.kind).toBe("gap_needs_human");
    expect(stored.importance).toBe("high");
    expect(stored.revision).toBe(seed.json.body.revision + 1);
  });

  // COMPANION (iii): POSITIVE CONTROL — the defaults still exist. Without this,
  // "absence preserves" would be indistinguishable from "creation is broken".
  test("a fresh id still CREATES with the literal defaults", async () => {
    const id = "b4r-fresh-id-defaults";
    const created = await resolve({ type: "uiQuestion_write", id });
    console.log("CREATED status=%d %j", created.status, created.json.body);
    expect(created.status).toBe(200);
    const stored = live(id)!;
    expect(stored.title).toBe("Untitled");
    expect(stored.body).toBe("");
    expect(stored.kind).toBe("question");
    expect(stored.importance).toBe("medium");
    expect(stored.visibility).toBe("public");
    expect(stored.revision).toBe(1);

    // and via the panel alias, the kind default differs
    const panelId = "b4r-fresh-id-defaults-panel";
    const asPanel = await resolve({ type: "uiPanel_write", id: panelId });
    expect(asPanel.status).toBe(200);
    expect(live(panelId)!.kind).toBe("info");
  });
});
