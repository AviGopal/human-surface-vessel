/**
 * FALSIFIER for the importance LEARNER — the operator's second half, "and it
 * should learn what is important from what it shows."
 *
 * RED BEFORE, measured on the unmodified vessel and recorded here because the
 * evidence disappears the moment the wiring lands: posting
 * `{type:"interactorObservation", obs_type:"exposure_outcome", …}` through this
 * very router returned
 *   400 {"error":"obs_type required, one of click, dwell, scroll, focus"}
 * for both exposure records, and `renderPolicy` stayed at revision 0 with
 * byKind byte-identical to DEFAULT_IMPORTANCE_WEIGHTS. There was no corpus, no
 * trigger and no learner: the ranking could not be wrong in a way anything
 * noticed.
 *
 * Each test is named for the defect it protects against, not for the code it
 * calls. Two of them — (c) and (e) — are the ones that decide whether this
 * feature is honest at all:
 *
 *   (c) NEVER SHOWN MOVES NOTHING. If absence of evidence moved a weight, the
 *       learner would learn what it already put on top: a self-confirming loop
 *       wearing the clothes of learning.
 *   (e) NO WEIGHT REACHES ZERO. A zero-weight kind would never be shown, would
 *       therefore never produce an outcome, and could never earn its way back.
 *
 * ISOLATION. `test/setup.ts` gives the whole process ONE WORKSPACE_ROOT, and
 * `participation-journal.ts` binds its directory at module init, so every test
 * in this process shares one journal and one in-memory policy. Tests therefore
 * use kind names unique to themselves and assert RELATIVE to the state they
 * observe, never against an absolute revision number — a test that assumes it
 * is the only writer measures the test order instead of the learner. The
 * fresh-process test (f) uses its own mkdtemp workspace, as
 * test/render-policy-durability.test.ts does.
 */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { impulsesRouter } from "../src/routes/impulses.ts";
import {
  IMPORTANCE_LEARNER_ID,
  MAX_STEP_FRACTION,
  MIN_KIND_WEIGHT,
  aggregateByKind,
  learnImportanceWeights,
} from "../src/importance-learn.ts";
import { DEFAULT_IMPORTANCE_WEIGHTS } from "../src/importance.ts";

/**
 * Prepend a corroborating exposure TICK covering every panel the given records
 * name, so a direct unit call exercises the same corroborated path the route
 * produces. The learner refuses an outcome for a panel no tick ever showed;
 * that rule has its own falsifier, so wrapping here tests the realistic path
 * rather than hiding the guard.
 */
/** learnImportanceWeights with the corroborating tick supplied. */
function learnCorroborated(records: readonly any[], ...rest: readonly any[]): any {
  return (learnImportanceWeights as any)(corroborated(records), ...rest);
}

function corroborated(records: readonly any[]): readonly any[] {
  const ids = [...new Set(records.filter(r => r?.type === "exposure_outcome" && r?.panelId).map(r => r.panelId as string))];
  if (ids.length === 0) return records;
  // A corpus that already carries its own ticks is left ALONE — otherwise this
  // helper would inject a second renderer bundle into tests whose subject is
  // which bundles the evidence spans.
  if (records.some(r => r?.type === "exposure")) return records;
  return [
    {
      type: "exposure",
      scanStatus: "observed",
      body: {
        visible_in_viewport: ids.map((id, i) => ({ panel_id: id, rank: i + 1 })),
        renderer_bundle: "test-bundle",
      },
    },
    ...records,
  ];
}

const routerModule = new URL("../src/routes/impulses.ts", import.meta.url).pathname;

async function resolve(pointer: Record<string, unknown>) {
  const res = await impulsesRouter.request("/v2/impulses/resolve", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pointer }),
  });
  return { status: res.status, json: (await res.json()) as any };
}

/** A solicitation of `kind`, so the outcome record's kind resolves at write time. */
async function seedPanel(id: string, kind: string) {
  const r = await resolve({
    type: "uiPanel_write",
    id,
    title: `panel ${id}`,
    kind,
    importance: "high",
    body: { text: "x" },
    asks: [{ id: "q", prompt: "?", type: "text" }],
  });
  expect(r.status).toBe(200);
}

/**
 * An exposure TICK naming panelIds in its measured slice.
 *
 * Every outcome in these falsifiers is preceded by one, because that is the
 * order the browser produces them in: the surface measures what is on screen,
 * then reports what the person did to it. It is also what the learner now
 * REQUIRES — an outcome for a panel no tick ever showed moves nothing, checked
 * against the tick record rather than against the producer's self-reported
 * count, since a channel's own reporting is not evidence about the channel.
 */
async function postTick(panelIds: readonly string[]) {
  return resolve({
    type: "interactorObservation",
    obs_type: "exposure",
    scan_status: "observed",
    // Sent at the POINTER's top level, not nested: the route collects every
    // non-column key into the record's `body`, so a literal `body` key would
    // arrive as body.body and the learner would never find the slice.
    visible_in_viewport: panelIds.map((id, index) => ({ panel_id: id, rank: index + 1 })),
    visible_in_viewport_count: panelIds.length,
    candidates_total: panelIds.length,
    renderer_bundle: "test-bundle",
    tick_seq: 1,
  });
}

async function postOutcome(
  panelId: string,
  outcome: string,
  extra: Record<string, unknown> = {},
) {
  // Corroborate first, unless a test is deliberately probing the uncorroborated
  // path (it passes skipTick).
  const { skipTick, ...rest } = extra as { skipTick?: boolean } & Record<string, unknown>;
  if (skipTick !== true) await postTick([panelId]);
  return resolve({
    type: "interactorObservation",
    obs_type: "exposure_outcome",
    panel_id: panelId,
    outcome,
    exposure_count: 2,
    ...rest,
  });
}

const policy = async () => (await resolve({ type: "renderPolicy" })).json.body;
const byKind = async () => (await policy()).importanceWeights.byKind as Record<string, number>;

/** Put `weights` in force as a HUMAN assignment — which is also the learner's anchor. */
async function operatorAssign(weights: Record<string, number>, reason: string) {
  const current = await byKind();
  const r = await resolve({
    type: "renderPolicy_write",
    importanceWeights: { byKind: { ...current, ...weights } },
    assignedBy: "operator:falsifier",
    reason,
  });
  expect(r.status).toBe(200);
  return r;
}

/** Ranks of panel ids in the ranked `uiQuestion` read — what a human is shown. */
async function ranks(): Promise<Map<string, number>> {
  const r = await resolve({ type: "uiQuestion", visible_slice_size: null });
  expect(r.status).toBe(200);
  const out = new Map<string, number>();
  for (const q of r.json.body.questions as Array<{ id: string; rank: number }>) {
    out.set(q.id, q.rank);
  }
  return out;
}

let seq = 0;
const uniqueKind = (label: string) => `learnerprobe_${label}_${++seq}`;

// ─── (a) answered raises a kind, and the rise reaches the next read ──────────

describe("(a) an answered kind rises — and the rise reaches what a human is shown", () => {
  test("weight up, rank up on the NEXT uiQuestion read, with no code change and no restart", async () => {
    const rising = uniqueKind("rising");
    const rival = uniqueKind("rival");
    // Two kinds a hair apart, assigned by a human so the anchor is that
    // assignment. `rising` starts BELOW `rival`; only evidence can invert them.
    await operatorAssign({ [rising]: 4, [rival]: 4.4 }, "(a) starting order");

    // The panel whose rank is measured is NEVER the one answered: answering it
    // drops its own unansweredBoost (24) and it would fall for that reason
    // alone. The rank that matters is a still-unanswered panel of the same kind.
    const witness = `a-witness-${seq}`;
    const rivalPanel = `a-rival-${seq}`;
    await seedPanel(witness, rising);
    await seedPanel(rivalPanel, rival);

    const before = await ranks();
    expect(before.get(rivalPanel)!).toBeLessThan(before.get(witness)!);
    const weightBefore = (await byKind())[rising]!;

    // Four distinct answered solicitations of `rising` — evidence about the
    // KIND, gathered from panels other than the witness.
    for (let i = 0; i < 4; i += 1) {
      const id = `a-answered-${seq}-${i}`;
      await seedPanel(id, rising);
      const r = await postOutcome(id, "answered");
      expect(r.status).toBe(200);
      expect(r.json.learning).toBeDefined();
    }

    const weightAfter = (await byKind())[rising]!;
    expect(weightAfter).toBeGreaterThan(weightBefore);
    // The rival never moved: no evidence names it.
    expect((await byKind())[rival]).toBe(4.4);

    // THE READ. Nothing was rebuilt, no module was re-imported, no process
    // restarted: the ranker consulted the impulse the learner wrote.
    const after = await ranks();
    expect(after.get(witness)!).toBeLessThan(after.get(rivalPanel)!);
    expect(after.get(witness)!).toBeLessThan(before.get(witness)!);
  });

  test("the learned revision names the learner and cites the evidence it moved on", async () => {
    const kind = uniqueKind("attrib");
    const id = `attrib-${seq}`;
    await seedPanel(id, kind);
    await operatorAssign({ [kind]: 4 }, "(a) attribution anchor");
    const r = await postOutcome(id, "answered");
    expect(r.json.learning.changed).toBe(true);
    const p = await policy();
    expect(p.assignedBy).toBe(IMPORTANCE_LEARNER_ID);
    expect(p.reason).toContain(kind);
    expect(p.reason).toContain("1 answered");
    expect(p.reason).toContain("never shown is not a negative outcome");
  });
});

// ─── (b) repeated shown-without-action lowers a kind ────────────────────────

describe("(b) repeatedly shown and never acted on lowers a kind", () => {
  test("three ignored solicitations pull the weight down, bounded", async () => {
    const kind = uniqueKind("ignored");
    await operatorAssign({ [kind]: 4 }, "(b) anchor");
    const before = (await byKind())[kind]!;
    for (let i = 0; i < 3; i += 1) {
      const id = `b-ignored-${seq}-${i}`;
      await seedPanel(id, kind);
      const r = await postOutcome(id, "shown_not_acted", { inferred: true });
      expect(r.status).toBe(200);
    }
    const after = (await byKind())[kind]!;
    expect(after).toBeLessThan(before);
    // BOUNDED: one pass may close at most MAX_STEP_FRACTION of the gap, so three
    // passes cannot have fallen further than three such steps from 4.
    expect(after).toBeGreaterThan(4 * (1 - MAX_STEP_FRACTION) ** 3 - 0.001);
  });

  test("a tick flood cannot manufacture negatives: the unit of evidence is a panel", () => {
    // ExposureLedger emits shown_not_acted on EVERY accepted refresh after the
    // first, so one ignored panel in a long session yields dozens of events
    // while an answer yields one. If evidence were counted per event, leaving a
    // tab open would outvote a person answering.
    const flood = Array.from({ length: 40 }, (_, i) => ({
      type: "exposure_outcome",
      panelId: "one-panel",
      panelKind: "floodkind",
      outcome: "shown_not_acted",
      exposureCount: i + 2,
    }));
    const { evidence } = aggregateByKind(corroborated(flood));
    expect(evidence).toHaveLength(1);
    expect(evidence[0]!.ignoredPanels).toBe(1);
    expect(evidence[0]!.beta).toBe(2); // prior 1 + one panel, not 1 + forty ticks
  });
});

// ─── (c) never shown moves nothing ──────────────────────────────────────────

describe("(c) a kind that was never shown moves nothing", () => {
  test("the weights of kinds with no records are BYTE-IDENTICAL after a pass", async () => {
    const kind = uniqueKind("onlyone");
    // The eight default kinds are never named by any record in this file, so
    // they are the never-shown set. Snapshot them as bytes.
    const names = Object.keys(DEFAULT_IMPORTANCE_WEIGHTS.byKind);
    const snapshot = (table: Record<string, number>) =>
      JSON.stringify(names.map((n) => [n, table[n]]));
    const before = snapshot(await byKind());

    const id = `c-${seq}`;
    await seedPanel(id, kind);
    const r = await postOutcome(id, "answered");
    expect(r.status).toBe(200);
    // Something DID move, so this is not a vacuous pass.
    expect((await byKind())[kind]).toBeDefined();

    expect(snapshot(await byKind())).toBe(before);
  });

  test("a corpus of exposure TICKS with no outcomes writes no revision at all", async () => {
    const revisionBefore = (await policy()).revision;
    const r = await resolve({
      type: "interactorObservation",
      obs_type: "exposure",
      tick_seq: 1,
      snapshot_count: 12,
      visible_in_viewport_count: 3,
      candidates_total: 12,
      not_in_visible_slice_count: 9,
      scan_status: "observed",
    });
    expect(r.status).toBe(200);
    // An exposure tick is a DENOMINATOR, not an outcome: nine solicitations
    // were withheld from the viewport and not one of them is scored for it.
    expect(r.json.learning).toBeUndefined();
    expect((await policy()).revision).toBe(revisionBefore);
    expect(r.json.body.body.not_in_visible_slice_count).toBe(9);
  });

  test("an outcome whose panel id resolves to no kind is skipped and counted, never bucketed", async () => {
    const r = await postOutcome(`c-unknown-panel-${++seq}`, "answered");
    expect(r.status).toBe(200);
    expect(r.json.body.panelKind).toBe(null);
    expect(r.json.learning.skipped.unresolvedKind).toBeGreaterThanOrEqual(1);
    for (const e of r.json.learning.evidence as Array<{ kind: string }>) {
      expect(e.kind).not.toBe("unknown");
      expect(e.kind).not.toBe("");
    }
  });
});

// ─── (d) a complaint is not a verdict on importance ─────────────────────────

describe("(d) a complaint alone does not lower importance", () => {
  test("complaint-only solicitations move no weight and get no entry", async () => {
    const kind = uniqueKind("complained");
    const ids = [`d-${seq}-0`, `d-${seq}-1`];
    for (const id of ids) await seedPanel(id, kind);
    let last;
    for (const id of ids) last = await postOutcome(id, "complained");
    expect(last!.status).toBe(200);
    const learning = last!.json.learning;
    // Counted and visible — a complaint is evidence about PRESENTATION, and
    // hiding what people struggle with is the inverse of the goal.
    expect(learning.skipped.complaintOnlyPanels).toBeGreaterThanOrEqual(2);
    for (const m of learning.moves as Array<{ kind: string }>) {
      expect(m.kind).not.toBe(kind);
    }
    expect((await byKind())[kind]).toBeUndefined();
  });

  test("a complaint on top of an answer neither adds to beta nor cancels the answer", () => {
    const pass = learnCorroborated(
      [
        { type: "exposure_outcome", panelId: "p", panelKind: "k", outcome: "answered" },
        { type: "exposure_outcome", panelId: "p", panelKind: "k", outcome: "complained" },
      ],
      { ...DEFAULT_IMPORTANCE_WEIGHTS, byKind: { k: 4 } },
      { byKind: { k: 4 }, source: "test" },
    );
    const e = pass.evidence[0]!;
    expect(e.answeredPanels).toBe(1);
    expect(e.complainedPanels).toBe(1);
    expect(e.beta).toBe(1); // the prior alone
    expect(pass.weights.byKind.k!).toBeGreaterThan(4);
  });
});

// ─── (e) no weight can be driven to zero ────────────────────────────────────

describe("(e) negative evidence can never make a kind permanently invisible", () => {
  test("forty ignored solicitations land on the floor, not on zero", async () => {
    const kind = uniqueKind("floor");
    await operatorAssign({ [kind]: 0.2 }, "(e) anchor near the floor");
    for (let i = 0; i < 40; i += 1) {
      const id = `e-${seq}-${i}`;
      await seedPanel(id, kind);
      const r = await postOutcome(id, "shown_not_acted", { inferred: true });
      expect(r.status).toBe(200);
    }
    const weight = (await byKind())[kind]!;
    expect(weight).toBeGreaterThan(0);
    // The floor is approached FROM ABOVE and never crossed: each bounded pass
    // closes a quarter of the remaining distance, so 40 passes land just above
    // it (measured: 0.1002) and no number of further passes can take it under.
    expect(weight).toBeGreaterThanOrEqual(MIN_KIND_WEIGHT);
    expect(weight).toBeLessThan(MIN_KIND_WEIGHT + 0.01);

    // And a kind sitting ON the floor is still SHOWN — it can therefore still
    // produce an outcome and still earn its way back, which is the property a
    // zero would destroy.
    const shown = `e-shown-${seq}`;
    await seedPanel(shown, kind);
    expect((await ranks()).has(shown)).toBe(true);
  });

  test("even a base of zero cannot produce a zero target", () => {
    const pass = learnCorroborated(
      Array.from({ length: 50 }, (_, i) => ({
        type: "exposure_outcome",
        panelId: `p${i}`,
        panelKind: "zeroed",
        outcome: "shown_not_acted",
        // Real records carry the count; an ignored record that cannot show a
        // SECOND presentation is skipped, so a fixture without it would be
        // testing the skip path instead of the floor.
        exposureCount: 2,
      })),
      { ...DEFAULT_IMPORTANCE_WEIGHTS, byKind: { zeroed: 0 } },
      { byKind: { zeroed: 0 }, source: "test" },
    );
    expect(pass.weights.byKind.zeroed!).toBeGreaterThanOrEqual(MIN_KIND_WEIGHT);
  });

  test("a converged pass refuses rather than manufacturing revisions", () => {
    const at = { ...DEFAULT_IMPORTANCE_WEIGHTS, byKind: { k: MIN_KIND_WEIGHT } };
    const records = Array.from({ length: 20 }, (_, i) => ({
      type: "exposure_outcome",
      panelId: `p${i}`,
      panelKind: "k",
      outcome: "shown_not_acted",
      exposureCount: 2,
    }));
    const pass = learnImportanceWeights(records, at, { byKind: { k: 0.2 }, source: "test" });
    expect(pass.moves).toHaveLength(0);
    expect(pass.weights.byKind.k).toBe(MIN_KIND_WEIGHT);
  });
});

// ─── never shown, enforced against the TICK rather than the producer ────────

describe("an outcome for a panel no tick showed moves nothing", () => {
  test("an uncorroborated outcome is refused by the learner and counted", async () => {
    const kind = uniqueKind("uncorroborated");
    await seedPanel("nc1", kind);
    await operatorAssign({ [kind]: 6 }, "anchor for the uncorroborated case");
    const before = await byKind();

    // No tick. The producer even claims a high exposure_count — which is
    // exactly the input that used to be believed, 47 of 47 times, in both
    // directions. The count is the PRODUCER's own report, and a channel's own
    // reporting is not evidence about the channel; the tick record is the
    // independent witness.
    const ignored = await postOutcome("nc1", "shown_not_acted", { skipTick: true, exposure_count: 7 });
    expect(ignored.status).toBe(200); // stored as a record…
    expect((await byKind())[kind]).toBe(before[kind]!); // …but it moved nothing

    const answered = await postOutcome("nc1", "answered", { skipTick: true });
    expect(answered.status).toBe(200);
    expect((await byKind())[kind]).toBe(before[kind]!); // neither direction moves

    // The skip is COUNTED, so a corpus that is all outcomes and no ticks
    // reports itself as such instead of looking like an absence of evidence.
    // Asserted on the STRUCTURED count, not on prose: the number is the thing
    // the learner is accountable for, and a sentence can be reworded.
    expect(answered.json.learning?.skipped?.uncorroborated).toBeGreaterThanOrEqual(2);
    expect(answered.json.learning?.reason ?? "").toContain("no exposure tick showed");

    // POSITIVE CONTROL at the same address: the same outcome, corroborated,
    // does move the weight — so the refusal above is attributable to the
    // missing tick and not to the test being unable to move anything.
    const corroboratedAct = await postOutcome("nc1", "answered");
    expect(corroboratedAct.status).toBe(200);
    expect((await byKind())[kind]!).toBeGreaterThan(before[kind]!);
  });
});

// ─── (f) the learned weights survive a fresh process ────────────────────────

describe("(f) what was learned survives a restart", () => {
  test("a weight learned in one process is in force in another, still attributed", () => {
    const workspace = mkdtempSync(join(tmpdir(), "human-surface-learn-"));
    try {
      const learner = Bun.spawnSync(
        [
          process.execPath,
          "-e",
          `
        const { impulsesRouter } = await import(${JSON.stringify(routerModule)});
        const post = async (pointer) => {
          const r = await impulsesRouter.request("/v2/impulses/resolve", {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ pointer }),
          });
          return r.json();
        };
        await post({ type: "uiPanel_write", id: "f1", title: "t", kind: "restartkind",
                     importance: "high", body: {}, asks: [{ id: "q", prompt: "?", type: "text" }] });
        await post({ type: "renderPolicy_write", importanceWeights: { byKind: { restartkind: 4 } },
                     assignedBy: "operator:falsifier", reason: "(f) anchor" });
        // The corroborating TICK first, exactly as the browser emits it: measure
        // what is on screen, then report what the person did to it. Without it
        // the outcome names a panel no tick ever showed and the learner refuses
        // to move on it.
        await post({ type: "interactorObservation", obs_type: "exposure", scan_status: "observed",
                     visible_in_viewport: [{ panel_id: "f1", rank: 1 }],
                     renderer_bundle: "restart-test" });
        const res = await post({ type: "interactorObservation", obs_type: "exposure_outcome",
                                 panel_id: "f1", outcome: "answered", exposure_count: 3 });
        const pol = await post({ type: "renderPolicy" });
        console.log(JSON.stringify({
          changed: res.learning.changed,
          weight: pol.body.importanceWeights.byKind.restartkind,
          assignedBy: pol.body.assignedBy,
        }));
      `,
        ],
        { env: { ...process.env, WORKSPACE_ROOT: workspace } },
      );
      expect(learner.exitCode).toBe(0);
      const learned = JSON.parse(learner.stdout.toString().trim().split("\n").pop()!);
      expect(learned.changed).toBe(true);
      expect(learned.weight).toBeGreaterThan(4);
      expect(learned.assignedBy).toBe(IMPORTANCE_LEARNER_ID);

      // SECOND PROCESS. Nothing is inherited in memory; the only path from the
      // first process to this one is the journal on disk.
      const reader = Bun.spawnSync(
        [
          process.execPath,
          "-e",
          `
        const { impulsesRouter } = await import(${JSON.stringify(routerModule)});
        const r = await impulsesRouter.request("/v2/impulses/resolve", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ pointer: { type: "renderPolicy" } }),
        });
        const pol = (await r.json()).body;
        console.log(JSON.stringify({
          weight: pol.importanceWeights.byKind.restartkind,
          assignedBy: pol.assignedBy,
          reason: pol.reason,
        }));
      `,
        ],
        { env: { ...process.env, WORKSPACE_ROOT: workspace } },
      );
      expect(reader.exitCode).toBe(0);
      const restored = JSON.parse(reader.stdout.toString().trim().split("\n").pop()!);
      expect(restored.weight).toBe(learned.weight);
      expect(restored.assignedBy).toBe(IMPORTANCE_LEARNER_ID);
      expect(restored.reason).toContain("restartkind");
      expect(restored.reason).toContain("1 answered");
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  }, 30_000);

  test("the exposure corpus itself is durable, so a second process can re-derive the same pass", () => {
    const workspace = mkdtempSync(join(tmpdir(), "human-surface-corpus-"));
    try {
      const writer = Bun.spawnSync(
        [
          process.execPath,
          "-e",
          `
        const { impulsesRouter } = await import(${JSON.stringify(routerModule)});
        const post = async (pointer) => {
          const r = await impulsesRouter.request("/v2/impulses/resolve", {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ pointer }),
          });
          return r.json();
        };
        await post({ type: "uiPanel_write", id: "g1", title: "t", kind: "corpuskind",
                     importance: "high", body: {}, asks: [{ id: "q", prompt: "?", type: "text" }] });
        await post({ type: "interactorObservation", obs_type: "exposure_outcome",
                     panel_id: "g1", outcome: "answered", exposure_count: 2,
                     renderer_bundle: "index-abc.js" });
        console.log("written");
      `,
        ],
        { env: { ...process.env, WORKSPACE_ROOT: workspace } },
      );
      expect(writer.exitCode).toBe(0);

      const reader = Bun.spawnSync(
        [
          process.execPath,
          "-e",
          `
        const { readExposureCorpus } = await import(${JSON.stringify(
          new URL("../src/importance-learn.ts", import.meta.url).pathname,
        )});
        const corpus = readExposureCorpus();
        console.log(JSON.stringify({
          count: corpus.length,
          kinds: corpus.map((r) => r.panelKind),
          // The provenance fields the browser sent are PERSISTED, not dropped.
          bundle: corpus[0] && corpus[0].body && corpus[0].body.renderer_bundle,
        }));
      `,
        ],
        { env: { ...process.env, WORKSPACE_ROOT: workspace } },
      );
      expect(reader.exitCode).toBe(0);
      const seen = JSON.parse(reader.stdout.toString().trim().split("\n").pop()!);
      expect(seen.count).toBe(1);
      expect(seen.kinds).toEqual(["corpuskind"]);
      expect(seen.bundle).toBe("index-abc.js");
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  }, 30_000);
});

// ─── every field added to the record is READ, not merely written ────────────

describe("the fields added to the exposure record have runtime readers", () => {
  test("exposureCount: an ignored record that cannot show a SECOND presentation is skipped", () => {
    const shownOnce = learnCorroborated(
      [
        {
          type: "exposure_outcome",
          panelId: "p1",
          panelKind: "k",
          outcome: "shown_not_acted",
          exposureCount: 1,
        },
        // …and one with no count at all: an absent key is not a populated one.
        { type: "exposure_outcome", panelId: "p2", panelKind: "k", outcome: "shown_not_acted" },
      ],
      { ...DEFAULT_IMPORTANCE_WEIGHTS, byKind: { k: 4 } },
      { byKind: { k: 4 }, source: "test" },
    );
    expect(shownOnce.skipped.shownOnceOrUnknown).toBe(2);
    expect(shownOnce.moves).toHaveLength(0);
    expect(shownOnce.weights.byKind.k).toBe(4);

    // The same two panels, now demonstrably shown twice: the weight falls.
    const shownTwice = learnCorroborated(
      ["p1", "p2"].map((panelId) => ({
        type: "exposure_outcome",
        panelId,
        panelKind: "k",
        outcome: "shown_not_acted",
        exposureCount: 2,
      })),
      { ...DEFAULT_IMPORTANCE_WEIGHTS, byKind: { k: 4 } },
      { byKind: { k: 4 }, source: "test" },
    );
    expect(shownTwice.skipped.shownOnceOrUnknown).toBe(0);
    expect(shownTwice.weights.byKind.k!).toBeLessThan(4);
  });

  test("inferred and outcomeScope are counted and stated in the learned reason", () => {
    const pass = learnCorroborated(
      [
        {
          type: "exposure_outcome",
          panelId: "p1",
          panelKind: "k",
          outcome: "shown_not_acted",
          exposureCount: 3,
          inferred: true,
        },
        {
          type: "exposure_outcome",
          panelId: "p2",
          panelKind: "k",
          outcome: "declined",
          outcomeScope: "ask",
          askId: "a1",
          exposureCount: 2,
        },
      ],
      { ...DEFAULT_IMPORTANCE_WEIGHTS, byKind: { k: 4 } },
      { byKind: { k: 4 }, source: "test" },
    );
    const e = pass.evidence[0]!;
    expect(e.inferredOpportunities).toBe(1);
    expect(e.askScopedActs).toBe(1);
    expect(pass.reason).toContain("machine-inferred");
    expect(pass.reason).toContain("addressed one ask");
  });

  test("scanStatus and the verbatim body are read: failed scans and renderer bundles are stated", () => {
    const pass = learnCorroborated(
      [
        {
          type: "exposure",
          scanStatus: "failed",
          body: { renderer_bundle: "index-old.js" },
        },
        // An OBSERVED tick is required alongside the failed one, because a
        // failed scan corroborates nothing — it never measured the screen, so
        // it cannot witness that p1 was shown. Carries no renderer_bundle so
        // the bundle assertion below still describes the two bundles the test
        // is about.
        {
          type: "exposure",
          scanStatus: "observed",
          body: { visible_in_viewport: [{ panel_id: "p1" }] },
        },
        {
          type: "exposure_outcome",
          panelId: "p1",
          panelKind: "k",
          outcome: "answered",
          exposureCount: 2,
          body: { renderer_bundle: "index-new.js" },
        },
      ],
      { ...DEFAULT_IMPORTANCE_WEIGHTS, byKind: { k: 4 } },
      { byKind: { k: 4 }, source: "test" },
    );
    expect(pass.skipped.failedScans).toBe(1);
    expect(pass.rendererBundles).toEqual(["index-new.js", "index-old.js"]);
    expect(pass.reason).toContain("1 failed exposure scan");
    expect(pass.reason).toContain("index-old.js");
    // A failed scan is NOT read as an empty slice, so it moved no weight of its
    // own; the answered outcome is what moved it.
    expect(pass.moves.map((m) => m.kind)).toEqual(["k"]);
  });

  test("the anchor is the last HUMAN assignment, so repeated passes converge instead of compounding", async () => {
    const kind = uniqueKind("anchor");
    const id = `anchor-${seq}`;
    await seedPanel(id, kind);
    await operatorAssign({ [kind]: 4 }, "anchor for convergence");
    await postOutcome(id, "answered");
    const first = (await byKind())[kind]!;
    // Twelve further passes driven by OTHER kinds' records: the same single
    // answer must not be re-applied multiplicatively each time. The ceiling is
    // 2 x the human's 4, and the target for one answer (posterior 2/3) is 5.333.
    for (let i = 0; i < 12; i += 1) {
      const other = `anchor-other-${seq}-${i}`;
      await seedPanel(other, uniqueKind("anchorother"));
      await postOutcome(other, "answered");
    }
    const after = (await byKind())[kind]!;
    expect(after).toBeGreaterThanOrEqual(first);
    expect(after).toBeLessThanOrEqual(4 * 2);
    expect(after).toBeLessThanOrEqual(5.3334);
  });
});

// ─── the anchor cannot be ratcheted by a write about something else ─────────

describe("an operator write that did not touch the weights is not a new anchor", () => {
  test("a presentation-only assignment does not let the learner re-anchor on its own output", async () => {
    const kind = uniqueKind("ratchet");
    await operatorAssign({ [kind]: 4 }, "the only human weight assignment");
    for (let i = 0; i < 3; i += 1) {
      const id = `ratchet-${seq}-${i}`;
      await seedPanel(id, kind);
      await postOutcome(id, "answered");
    }
    const learned = (await byKind())[kind]!;
    expect(learned).toBeGreaterThan(4);

    // A human changes something ELSE. `writeRenderPolicy` journals the WHOLE
    // policy, so this snapshot carries the learner's byKind under an operator's
    // name — and if that counted as a new human anchor, every unrelated write
    // would raise the ceiling to twice a table that already holds the learning.
    const presentationBefore = (await policy()).presentation;
    const flip = await resolve({
      type: "renderPolicy_write",
      presentation: presentationBefore === "onepage" ? "stacked" : "onepage",
      assignedBy: "operator:falsifier",
      reason: "a write about presentation, not about importance",
    });
    expect(flip.status).toBe(200);

    for (let i = 0; i < 6; i += 1) {
      const id = `ratchet-after-${seq}-${i}`;
      await seedPanel(id, kind);
      await postOutcome(id, "answered");
    }
    // The ceiling is still 2 x the human's 4, and the target for an all-answered
    // kind approaches it from below; nothing here may exceed it.
    const after = (await byKind())[kind]!;
    expect(after).toBeLessThanOrEqual(8);
    // Stronger: with 9 answered panels the posterior is 10/11, so the target is
    // 4 x 2 x 10/11 = 7.2727 and the weight must stay under it.
    expect(after).toBeLessThanOrEqual(7.2728);

    // Leave the shared policy as it was found: this process is shared with
    // every other test file, and a presentation flip is not this test's to keep.
    const restore = await resolve({
      type: "renderPolicy_write",
      presentation: presentationBefore,
      assignedBy: "operator:falsifier",
      reason: "restoring the presentation this test borrowed",
    });
    expect(restore.status).toBe(200);
    expect((await policy()).presentation).toBe(presentationBefore);
  });
});

// ─── refusals: a corpus of unusable records must not look like evidence ─────

describe("the corpus refuses records it could only store and skip", () => {
  test("an exposure_outcome with no panel_id is refused, naming what is accepted", async () => {
    const r = await resolve({
      type: "interactorObservation",
      obs_type: "exposure_outcome",
      outcome: "answered",
    });
    expect(r.status).toBe(400);
    expect(r.json.error).toContain("panel_id");
    expect(r.json.error).toContain("shown_not_acted");
  });

  test("an unrecognised outcome is refused rather than silently dropped to a default", async () => {
    const id = `refuse-${++seq}`;
    await seedPanel(id, uniqueKind("refuse"));
    const r = await postOutcome(id, "loved_it");
    expect(r.status).toBe(400);
    expect(r.json.error).toContain("loved_it");
  });
});
