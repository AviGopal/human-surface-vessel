/**
 * FALSIFIERS for "the surface orders what it shows by an importance signal read
 * at use time from the renderPolicy impulse".
 *
 * The directive: "the system should always show what it thinks is most
 * important, and it should learn what is important from what it shows." This
 * file covers the ORDERING half and, critically, the mechanism the learning half
 * needs: the weights are DATA on the impulse, read at request time, so changing
 * them changes the order with NO code change and NO restart. A ranking that can
 * only be changed by editing source cannot be learned.
 *
 * Why every case runs in a FRESH SUBPROCESS against a DISPOSABLE WORKSPACE
 * (the pattern test/render-policy-durability.test.ts established):
 *
 *   1. the shared `bun test` process holds ~36 solicitable panels written by
 *      sibling test files, so an exact-ORDER assertion made in-process would be
 *      measuring other files' seeds and would flap the moment one is added;
 *   2. `renderPolicy` is process-global. Writing inverted weights in the shared
 *      process would leak that policy into every sibling test that reads it.
 *
 * WHAT IS DELIBERATELY NOT ASSERTED: no total count of panels, and no claim that
 * the seeded ids are the only ones present. Containment and RELATIVE ORDER only
 * — a count assertion passes for the wrong reason and breaks for the wrong
 * reason.
 *
 * NOT SATISFIABLE BY A NO-OP: case (b) demands the order INVERT under inverted
 * weights, so "rank everything the same" fails it (a constant order cannot
 * invert), and a comment cannot satisfy it. Case (a) compares the route's order
 * against `rankPanels`' own order over the same inputs, so an order that merely
 * looks plausible fails.
 */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DEFAULT_IMPORTANCE_WEIGHTS } from "../src/importance.ts";
import { DEFAULT_VISIBLE_SLICE_SIZE } from "../src/store.ts";

const storeModule = new URL("../src/store.ts", import.meta.url).pathname;
const routerModule = new URL("../src/routes/impulses.ts", import.meta.url).pathname;
const importanceModule = new URL("../src/importance.ts", import.meta.url).pathname;

/** Run a script in a FRESH bun process against `workspace`; nothing is inherited in memory. */
function inFreshProcess(workspace: string, script: string) {
  const child = Bun.spawnSync([process.execPath, "-e", script], {
    env: { ...process.env, WORKSPACE_ROOT: workspace },
  });
  return {
    exitCode: child.exitCode,
    stdout: child.stdout.toString(),
    stderr: child.stderr.toString(),
  };
}

function lastJson(stdout: string) {
  return JSON.parse(stdout.trim().split("\n").pop()!);
}

/**
 * The scenario, run once in one subprocess: seed panels of several kinds and
 * ages, read the ranked payload, invert the weights THROUGH THE IMPULSE, read
 * again, then exercise the slice from the policy and from a request.
 *
 * Ages are separated by whole days so no two seeds sit within floating-point
 * distance of each other — a knife-edge tie would make the comparison against
 * `rankPanels` a coin flip on `Date.now()` drift between the route's clock read
 * and the test's.
 */
const SCENARIO = `
  const store = await import(${JSON.stringify(storeModule)});
  const { impulsesRouter } = await import(${JSON.stringify(routerModule)});
  const { rankPanels } = await import(${JSON.stringify(importanceModule)});
  const DAY = 86400000;
  const now = Date.now();

  // Several kinds, several ages, one INVENTED kind no weight table knows, one
  // informational panel (which solicits nothing and must not be listed at all),
  // and one answered escalation.
  const seeds = [
    { id: "rk-stale-escalation",  kind: "gap_needs_human",                    importance: "high",   createdAt: now - 22 * DAY },
    { id: "rk-fresh-escalation",  kind: "gap_needs_human",                    importance: "high",   createdAt: now - 1 * DAY  },
    { id: "rk-pending-verify",    kind: "gap_pending_verification",           importance: "medium", createdAt: now - 9 * DAY  },
    { id: "rk-question",          kind: "question",                           importance: "high",   createdAt: now - 4 * DAY  },
    { id: "rk-invented-kind",     kind: "escalation_kind_nobody_invented_yet", importance: "high",  createdAt: now - 6 * DAY  },
    { id: "rk-localization",      kind: "gap_needs_localization",             importance: "high",   createdAt: now - 14 * DAY },
    { id: "rk-info",              kind: "info",                               importance: "low",    createdAt: now - 20 * DAY },
  ];
  for (const s of seeds) {
    store.upsertPanel({ id: s.id, title: "seed " + s.id, body: "b", kind: s.kind, importance: s.importance, createdAt: s.createdAt });
  }

  async function resolve(pointer) {
    const res = await impulsesRouter.request("/v2/impulses/resolve", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ pointer }),
    });
    return { status: res.status, json: await res.json() };
  }
  const read = async (pointer = { type: "uiQuestion" }) => (await resolve(pointer)).json.body;

  // The same inputs the route ranks, so the comparison is against the pure
  // scorer's order over THIS set and not against a hand-written expectation.
  const views = () => store.listPanels().filter(store.isSolicitation).map(store.questionView);
  const rankedIds = (weights) => rankPanels(views(), weights, Date.now()).map(s => s.panel.id);

  const defaultWeights = store.getRenderPolicy().importanceWeights;
  const before = await read();
  const expectedBefore = rankedIds(defaultWeights);

  // INVERSION, written through the shaped impulse — the only channel. The
  // assertion compares against rankPanels over the new weights rather than
  // against a hand-written reversal, because the id tiebreak decides ties.
  // INVERT BY REVERSING THE ASSIGNMENT, NOT BY NEGATING.
  //
  // Negation used to be the technique here, and it made this proof depend on an
  // ILLEGAL weight domain: a kind at or below zero sorts last, is cut by every
  // slice, is therefore never shown, therefore produces no outcome record, and
  // so the learner can never lift it again — verified, five passes left such a
  // weight exactly where it was put. The policy write now refuses weights
  // below the learner's own floor for that reason.
  //
  // Reversing which kind gets which of the SAME numbers proves the same thing
  // strictly better: the order follows the weights, and the proof stays inside
  // the domain a caller is actually allowed to write.
  const reverseAssignment = (m) => {
    const keys = Object.keys(m);
    const values = keys.map(k => m[k]).slice().reverse();
    return Object.fromEntries(keys.map((k, i) => [k, values[i]]));
  };
  const inverted = {
    byKind: reverseAssignment(defaultWeights.byKind),
    agePerDay: defaultWeights.agePerDay,
    declaredImportance: reverseAssignment(defaultWeights.declaredImportance),
    unansweredBoost: defaultWeights.unansweredBoost,
  };
  const write = await resolve({
    type: "renderPolicy_write",
    importanceWeights: inverted,
    assignedBy: "test:importance-ranking-falsifier",
    reason: "law-1 proof: invert the weights on the impulse and watch the order invert with no code change and no restart",
  });
  const after = await read();
  const expectedAfter = rankedIds(store.getRenderPolicy().importanceWeights);

  // Back to the defaults, then a SLICE written through the policy.
  await resolve({ type: "renderPolicy_write", importanceWeights: defaultWeights, assignedBy: "test:importance-ranking-falsifier", reason: "restore" });
  const restored = await read();
  const sliceWrite = await resolve({ type: "renderPolicy_write", visible_slice_size: 3, assignedBy: "test:importance-ranking-falsifier", reason: "slice falsifier, snake_case spelling" });
  const sliced = await read();
  // A request may ask for a different slice, and the response must say so.
  const overridden = await read({ type: "uiQuestion", visibleSliceSize: null });
  const single = await read({ type: "uiQuestion", id: "rk-question" });
  const junk = await read({ type: "uiQuestion", visibleSliceSize: -4 });

  console.log(JSON.stringify({
    before, expectedBefore,
    write: { status: write.status, changed_fields: write.json.changed_fields, weights: write.json.body && write.json.body.importanceWeights, revision: write.json.body && write.json.body.revision },
    after, expectedAfter,
    restored, sliceWrite: { status: sliceWrite.status, changed_fields: sliceWrite.json.changed_fields },
    sliced, overridden, single, junk,
    defaultWeights,
  }));
`;

describe("the uiQuestion read is ordered by importance weights taken off the impulse", () => {
  const workspace = mkdtempSync(join(tmpdir(), "human-surface-ranking-"));
  let out: ReturnType<typeof inFreshProcess>;
  let r: any;
  try {
    out = inFreshProcess(workspace, SCENARIO);
    r = out.exitCode === 0 ? lastJson(out.stdout) : null;
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }

  test("the scenario subprocess ran at all", () => {
    // A cycle-broken import throws here rather than anywhere useful, so it is
    // named: store.ts reads DEFAULT_IMPORTANCE_WEIGHTS while building its
    // initial policy, and a runtime edge back from importance.ts to store.ts
    // would make this a ReferenceError under one load order.
    expect(out.stderr + out.stdout).not.toContain("ReferenceError");
    expect(out.stderr).toBe("");
    expect(out.exitCode).toBe(0);
    expect(r).not.toBeNull();
  });

  test("(a) the order the route returns IS rankPanels' order over the same panels", () => {
    const ids = r.before.questions.map((q: any) => q.id);
    // CONTAINMENT: every seeded solicitation is listed, the informational one is not.
    expect(ids).toContain("rk-stale-escalation");
    expect(ids).toContain("rk-fresh-escalation");
    expect(ids).toContain("rk-pending-verify");
    expect(ids).toContain("rk-question");
    expect(ids).toContain("rk-localization");
    expect(ids).not.toContain("rk-info");
    // ORDER: identical to the pure scorer's, not merely plausible.
    expect(ids).toEqual(r.expectedBefore);
    // And it is NOT the store's default `updatedAt` order, which is what the
    // reader returned before this change — all seven were written in one pass,
    // so the recency order is the write order.
    expect(ids).not.toEqual(["rk-localization", "rk-invented-kind", "rk-question", "rk-pending-verify", "rk-fresh-escalation", "rk-stale-escalation"]);
    // The stale escalation outranks the fresh one of the SAME kind and declared
    // importance: waiting is the only difference, so the age term is live.
    expect(ids.indexOf("rk-stale-escalation")).toBeLessThan(ids.indexOf("rk-fresh-escalation"));
  });

  test("(a) every row carries its rank and the reasons for it", () => {
    const rows = r.before.questions;
    expect(rows.length).toBeGreaterThan(1);
    rows.forEach((row: any, index: number) => {
      expect(row.rank).toBe(index + 1);
      expect(Array.isArray(row.because)).toBe(true);
      // A human must be able to DISAGREE with it, so it has to be words.
      expect(row.because.length).toBeGreaterThan(2);
      for (const reason of row.because) expect(reason).toMatch(/[a-z]{3}/);
      // The view fields the browser and the answer path already depend on survive.
      expect(row).toHaveProperty("answered");
      expect(row).toHaveProperty("revision");
    });
    const top = rows[0];
    expect(top.because.join(" | ")).toMatch(/waiting \d+ days/);
    expect(r.before.ranking.explanation).toContain(top.title);
  });

  test("(b) LAW 1 — inverted weights on the impulse invert the order, no code change, no restart", () => {
    expect(r.write.status).toBe(200);
    expect(r.write.changed_fields).toContain("importanceWeights");
    // The impulse now CARRIES the weights in force — a reader can see them.
    // The impulse carries the weights actually in force, and they are the
    // REVERSED assignment rather than negated values — so the proof that the
    // order follows the impulse no longer depends on writing a weight the
    // policy refuses. gap_needs_human is the first key of byKind, so under the
    // reversal it now holds what the LAST key held.
    const kindKeys = Object.keys(r.defaultWeights.byKind);
    const lastKind = kindKeys[kindKeys.length - 1];
    expect(r.write.weights.byKind.gap_needs_human).toBe(r.defaultWeights.byKind[lastKind]);
    expect(r.write.weights.unansweredBoost).toBe(r.defaultWeights.unansweredBoost);
    // Every weight in force stays inside the legal domain.
    for (const value of Object.values(r.write.weights.byKind)) expect(value as number).toBeGreaterThan(0);

    const before = r.before.questions.map((q: any) => q.id);
    const after = r.after.questions.map((q: any) => q.id);
    // The route's new order is the scorer's order under the NEW weights…
    expect(after).toEqual(r.expectedAfter);
    // …it actually moved…
    expect(after).not.toEqual(before);
    // …and it moved by re-ranking, not by dropping or adding rows.
    expect([...after].sort()).toEqual([...before].sort());
    // NOT asserted: that the new order is the exact mirror of the old. That held
    // while this test negated every weight, and it is false for a reversed
    // ASSIGNMENT — age and the unanswered boost are unchanged and still push in
    // the same direction, so only the kind contribution is permuted. The real
    // law-1 claim is the assertion above: the order the route SERVED equals the
    // order the pure scorer computes under the weights now on the impulse. That
    // is stronger than a mirror, because a mirror can also be produced by a
    // hardcoded reversal that ignores the weights entirely.
    // Same process, same code, only the impulse differs.
    expect(r.restored.questions.map((q: any) => q.id)).toEqual(before);
    expect(r.after.ranking.policy_revision).toBeGreaterThan(r.before.ranking.policy_revision);
  });

  test("(c) a kind no weight table knows is still shown, and says so", () => {
    const row = r.before.questions.find((q: any) => q.id === "rk-invented-kind");
    expect(row).toBeTruthy();
    expect(row.because.join(" | ")).toContain("nobody has ranked yet");
    // Not buried at the bottom either: it scores at the neutral default, which
    // here puts it above the lowest-weighted recognised solicitation.
    const ids = r.before.questions.map((q: any) => q.id);
    expect(ids.indexOf("rk-invented-kind")).toBeLessThan(ids.length - 1);
  });

  test("(d) the slice is honest: it comes from the policy and states what it hides", () => {
    // Default: the documented policy value, and nothing hidden at this scale.
    expect(r.before.ranking.slice_size).toBe(DEFAULT_VISIBLE_SLICE_SIZE);
    expect(r.before.ranking.slice_source).toBe("policy");
    expect(r.before.ranking.not_shown_count).toBe(0);
    expect(r.before.ranking.shown_count).toBe(r.before.ranking.solicitations_total);

    // A slice written through the impulse truncates — visibly.
    expect(r.sliceWrite.status).toBe(200);
    expect(r.sliceWrite.changed_fields).toContain("visibleSliceSize");
    const full = r.restored.questions.map((q: any) => q.id);
    const shown = r.sliced.questions.map((q: any) => q.id);
    expect(shown).toEqual(full.slice(0, 3));
    expect(r.sliced.ranking.shown_count).toBe(3);
    expect(r.sliced.ranking.solicitations_total).toBe(r.restored.ranking.solicitations_total);
    expect(r.sliced.ranking.not_shown_count).toBe(full.length - 3);
    // `total` keeps meaning "every solicitation this read matched", so a caller
    // can tell a slice from the whole by comparing it to what it received.
    expect(r.sliced.total).toBe(full.length);
    expect(r.sliced.total).toBeGreaterThan(r.sliced.questions.length);
    expect(r.sliced.unanswered).toBe(r.restored.unanswered);
    expect(r.sliced.ranking.explanation).toContain("not shown");
    expect(r.sliced.ranking.explanation).toContain(`Showing 3 of ${full.length}`);

    // A request may override the size, and the response NAMES the source so an
    // override cannot masquerade as the policy in force.
    expect(r.overridden.questions.map((q: any) => q.id)).toEqual(full);
    expect(r.overridden.ranking.slice_source).toBe("request");
    expect(r.overridden.ranking.slice_size).toBeNull();
    expect(r.sliced.ranking.slice_source).toBe("policy");

    // An id-filtered read ranks the set it matched, and reports that set.
    expect(r.single.questions.map((q: any) => q.id)).toEqual(["rk-question"]);
    expect(r.single.ranking.solicitations_total).toBe(1);
    expect(r.single.ranking.not_shown_count).toBe(0);

    // A slice size this route cannot use is REFUSED AND NAMED, never rounded
    // into something the caller did not ask for.
    expect(r.junk.ranking.slice_source).toBe("policy");
    expect(JSON.stringify(r.junk.ranking.rejected_values)).toContain("non-negative integer");
  });

  test("learned weights survive a restart — a claim to have learned cannot rest on state that evaporates", () => {
    const ws = mkdtempSync(join(tmpdir(), "human-surface-ranking-durable-"));
    try {
      const writer = inFreshProcess(ws, `
        const { impulsesRouter } = await import(${JSON.stringify(routerModule)});
        const res = await impulsesRouter.request("/v2/impulses/resolve", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ pointer: {
            type: "renderPolicy_write",
            importance_weights: { by_kind: { gap_needs_human: 99, info: 0.1 }, age_per_day: 2, unanswered_boost: 5 },
            visible_slice_size: 7,
            assignedBy: "activity:importance_learn",
            reason: "durability of a learned weight table",
          } }),
        });
        console.log(JSON.stringify({ status: res.status, body: (await res.json()).body }));
      `);
      expect(writer.stderr).toBe("");
      expect(writer.exitCode).toBe(0);
      const written = lastJson(writer.stdout);
      expect(written.status).toBe(200);
      // snake_case reached the writer, and an omitted weight field kept the value in force.
      expect(written.body.importanceWeights.byKind).toEqual({ gap_needs_human: 99, info: 0.1 });
      expect(written.body.importanceWeights.agePerDay).toBe(2);
      expect(written.body.importanceWeights.declaredImportance).toEqual(
        DEFAULT_IMPORTANCE_WEIGHTS.declaredImportance,
      );

      const reader = inFreshProcess(ws, `
        const store = await import(${JSON.stringify(storeModule)});
        console.log(JSON.stringify(store.getRenderPolicy()));
      `);
      expect(reader.exitCode).toBe(0);
      const restored = lastJson(reader.stdout);
      expect(restored.importanceWeights.byKind).toEqual({ gap_needs_human: 99, info: 0.1 });
      expect(restored.importanceWeights.unansweredBoost).toBe(5);
      expect(restored.visibleSliceSize).toBe(7);
      expect(restored.revision).toBe(written.body.revision);
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });

  test("a weight entry this route cannot use is named, not silently dropped", () => {
    const ws = mkdtempSync(join(tmpdir(), "human-surface-ranking-reject-"));
    try {
      const out2 = inFreshProcess(ws, `
        const { impulsesRouter } = await import(${JSON.stringify(routerModule)});
        const call = async (pointer) => {
          const res = await impulsesRouter.request("/v2/impulses/resolve", {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ pointer }),
          });
          return { status: res.status, json: await res.json() };
        };
        const partial = await call({ type: "renderPolicy_write", importanceWeights: { byKind: { question: 3, broken: "high" }, agePerDay: "soon" } });
        const allBad = await call({ type: "renderPolicy_write", importanceWeights: { byKind: { alsoBroken: null } , agePerDay: NaN } });
        console.log(JSON.stringify({ partial, allBad }));
      `);
      expect(out2.exitCode).toBe(0);
      const { partial, allBad } = lastJson(out2.stdout);
      // A write that still moved a field is applied and reported as PARTIAL.
      expect(partial.status).toBe(200);
      expect(partial.json.partial).toBe(true);
      expect(JSON.stringify(partial.json.rejected_values)).toContain("byKind.broken");
      expect(JSON.stringify(partial.json.rejected_values)).toContain("agePerDay");
      expect(partial.json.body.importanceWeights.byKind).toEqual({ question: 3 });
      // A write whose every entry was junk moved nothing: refused, and it says
      // which values it could not use rather than blaming an unknown key. It
      // must NOT read as "clear the table" — one fat-fingered weight would
      // otherwise destroy the whole ranking — so the table in force survives.
      expect(allBad.status).toBeGreaterThanOrEqual(400);
      expect(JSON.stringify(allBad.json.rejected_values)).toContain("alsoBroken");
      expect(JSON.stringify(allBad.json.rejected_values)).toContain("send {} if you mean to clear it");
      expect(allBad.json.policy.importanceWeights.byKind).toEqual({ question: 3 });
      expect(allBad.json.unread_keys).not.toContain("importanceWeights");
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });
});
