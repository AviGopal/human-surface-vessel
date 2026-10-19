/**
 * FALSIFIER for gap a-human-surface-test-appends-501-fake-feedback-records-per-run-to-the-live-participation-journal,
 * the learner half: a test-origin line in the participation corpus is not evidence.
 *
 * From 09-22 to 09-27 suite runs that skipped the test workspace appended their
 * fixtures to the live corpus: exposure ticks with renderer_bundle "test-bundle"
 * and outcomes on learnerprobe_* kinds, none of them carrying the exposure
 * reporter's origin/producer stamp. importance_learn read them as evidence, named
 * "test-bundle" in its reason, and after each operator reset of the policy
 * re-derived the learnerprobe_* kinds from the same lines.
 *
 * The corpus below is written verbatim in the live shapes: stamped records as
 * the browser reporter sends them, unstamped ones as the test runs left them,
 * and a stamped act on a test panel (the browser was shown the leaked panels and
 * reported on them). Each case runs in its own process over its own workspace,
 * so the learners read exactly this file and nothing another test wrote.
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const stamp = { origin: "machine", producer: "human-surface-vessel/ui/exposure-reporter" };
const at = 1790113526000;

/** What the browser reporter sends: every record stamped, a real bundle. */
const real = [
  { type: "exposure", visibility: "operator_only", scanStatus: "observed", panelKind: null, observedAt: at,
    body: { ...stamp, renderer_bundle: "index-real.js", tick_seq: 1,
      visible_in_viewport: ["real-1", "real-2", "refuse-24"].map((panel_id, i) => ({ panel_id, rank: i + 1 })) } },
  ...["real-1", "real-2"].map((panelId, i) => ({
    type: "exposure_outcome", panelId, visibility: "operator_only", outcome: "answered", outcomeScope: "panel",
    exposureCount: 2, inferred: false, panelKind: "gap_needs_human", observedAt: at + 10 + i,
    body: { ...stamp, renderer_bundle: "index-real.js" } })),
  ...Array.from({ length: 5 }, (_, i) => ({
    type: "exposure_outcome", panelId: `form-real-${i}`, visibility: "operator_only", outcome: "complained",
    outcomeScope: "panel", exposureCount: 2, inferred: false, panelKind: "gap_needs_human", observedAt: at + 20 + i,
    body: { ...stamp, renderer_bundle: "index-real.js", form: "record", form_source: "dom", shape: "real_shape" } })),
];

/** What the leaked suite runs left: no stamp, the test bundle, test kinds. */
const testOrigin = [
  { type: "exposure", visibility: "operator_only", scanStatus: "observed", panelKind: null, observedAt: at + 30,
    body: { visible_in_viewport: [0, 1, 2, 3].map(i => ({ panel_id: `a-answered-2-${i}`, rank: i + 1 })),
      visible_in_viewport_count: 4, candidates_total: 4, renderer_bundle: "test-bundle", tick_seq: 1 } },
  ...[0, 1, 2, 3].map(i => ({
    type: "exposure_outcome", panelId: `a-answered-2-${i}`, visibility: "operator_only", outcome: "answered",
    outcomeScope: "panel", exposureCount: 2, panelKind: "learnerprobe_rising_1", observedAt: at + 31 + i })),
  ...Array.from({ length: 5 }, (_, i) => ({
    type: "exposure_outcome", panelId: `d-7-${i}`, visibility: "operator_only", outcome: "complained",
    outcomeScope: "panel", exposureCount: 2, panelKind: "learnerprobe_complained_7", observedAt: at + 40 + i,
    body: { form: "record", form_source: "dom", shape: "probe_shape" } })),
  // Stamped, but on a panel a test run seeded: the panel carries no provenance,
  // so its kind is the only marker.
  { type: "exposure_outcome", panelId: "refuse-24", visibility: "operator_only", outcome: "shown_not_acted",
    outcomeScope: "panel", exposureCount: 2, inferred: true, panelKind: "learnerprobe_refuse_25", observedAt: at + 50,
    body: { ...stamp, renderer_bundle: "index-real.js" } },
];

const learnerModule = new URL("../src/importance-learn.ts", import.meta.url).pathname;
const formModule = new URL("../src/form-learn.ts", import.meta.url).pathname;
const storeModule = new URL("../src/store.ts", import.meta.url).pathname;

/** One learner pass of each kind over exactly `records`, in a fresh process. */
function passOver(records: readonly unknown[], panels: readonly unknown[] = []): any {
  const workspace = mkdtempSync(join(tmpdir(), "human-surface-provenance-"));
  try {
    mkdirSync(join(workspace, "interactor-log"));
    writeFileSync(join(workspace, "interactor-log", "interactorObservation_write.jsonl"),
      records.map(r => JSON.stringify(r)).join("\n") + "\n");
    if (panels.length > 0) {
      writeFileSync(join(workspace, "interactor-log", "uiPanel_write.jsonl"),
        panels.map(r => JSON.stringify(r)).join("\n") + "\n");
    }
    const child = Bun.spawnSync([process.execPath, "-e", `
      const { runImportanceLearningPass } = await import(${JSON.stringify(learnerModule)});
      const { runFormLearningPass } = await import(${JSON.stringify(formModule)});
      const { getRenderPolicy } = await import(${JSON.stringify(storeModule)});
      const importance = runImportanceLearningPass();
      const form = runFormLearningPass();
      console.log(JSON.stringify({
        evidenceKinds: importance.pass.evidence.map(e => e.kind),
        written: getRenderPolicy().importanceWeights.byKind,
        rendererBundles: importance.pass.rendererBundles,
        reason: importance.pass.reason,
        formShapes: form.evidence.map(p => p.shape),
        formTable: form.learnedFormByShape,
        formReason: form.reason,
      }));
    `], { cwd: workspace, env: { ...process.env, WORKSPACE_ROOT: workspace } });
    if (child.exitCode !== 0) throw new Error(child.stderr.toString());
    const lines = child.stdout.toString().trim().split("\n");
    return JSON.parse(lines[lines.length - 1]!);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}

describe("the learners read only provenance-stamped, non-test evidence", () => {
  test("must-fail: a pass over a corpus mixing live and test-origin lines reads 0 learnerprobe kinds and no test-bundle", () => {
    const mixed = passOver([...real, ...testOrigin]);
    const liveOnly = passOver(real);
    expect(mixed.evidenceKinds.filter((k: string) => k.startsWith("learnerprobe_"))).toEqual([]);
    expect(Object.keys(mixed.written).filter(k => k.startsWith("learnerprobe_"))).toEqual([]);
    expect(mixed.rendererBundles).not.toContain("test-bundle");
    expect(mixed.reason).not.toContain("test-bundle");
    expect(mixed.formShapes).not.toContain("probe_shape");
    expect(mixed.formTable).not.toHaveProperty("probe_shape");
    // Each reason states what it excluded: 10 unstamped records, 1 stamped act on a test kind.
    for (const reason of [mixed.reason, mixed.formReason]) {
      expect(reason).toContain("Excluded before scoring: 10 record(s) without the exposure reporter's origin/producer stamp");
      expect(reason).toContain("1 stamped outcome(s) on a test-run kind");
    }
    expect(liveOnly.reason).toContain("Excluded before scoring: 0 record(s)");
    // The live kinds' weights are exactly where a live-only corpus puts them.
    expect(mixed.written.gap_needs_human).toBe(liveOnly.written.gap_needs_human);
    expect(mixed.formTable).toEqual(liveOnly.formTable);
  });

  test("control: live records still count", () => {
    const liveOnly = passOver(real);
    expect(liveOnly.evidenceKinds).toEqual(["gap_needs_human"]);
    expect(liveOnly.rendererBundles).toEqual(["index-real.js"]);
    expect(liveOnly.reason).toContain("gap_needs_human: 2 answered");
    expect(liveOnly.formTable).toEqual({ real_shape: "text" });
  });
});

/*
 * RETIREMENT (gap a-learned-kind-with-no-remaining-evidence-never-decays-out-of-the-in-force-table).
 * Excluding the leaked lines stops a kind being RE-learned, but the learners copy the
 * table in force, so a test kind already in it was carried forward by every pass. A kind
 * (or form shape) whose recorded evidence is ALL provenance-excluded is retired through
 * the learner's own write, with the reason in the revision. A kind with no records at
 * all is merely unseen and stays byte-identical.
 */
const startTable = {
  byKind: { gap_needs_human: 4, unseen_live: 3.25, learnerprobe_rising_1: 7.5, learnerprobe_refuse_25: 9.5, learnerprobe_unseen_9: 2 },
  learnedFormByShape: { probe_shape: "text", unseen_shape: "text" },
};

/** Put `startTable` in force as an operator write, run both passes as the route does, report the policy. */
function passFrom(records: readonly unknown[]): any {
  const workspace = mkdtempSync(join(tmpdir(), "human-surface-retire-"));
  try {
    mkdirSync(join(workspace, "interactor-log"));
    writeFileSync(join(workspace, "interactor-log", "interactorObservation_write.jsonl"),
      records.map(r => JSON.stringify(r)).join("\n") + "\n");
    const child = Bun.spawnSync([process.execPath, "-e", `
      const { runImportanceLearningPass, IMPORTANCE_LEARNER_ID } = await import(${JSON.stringify(learnerModule)});
      const { runFormLearningPass, FORM_LEARNER_ID } = await import(${JSON.stringify(formModule)});
      const store = await import(${JSON.stringify(storeModule)});
      const start = ${JSON.stringify(startTable)};
      store.writeRenderPolicy({ importanceWeights: { byKind: { ...store.getRenderPolicy().importanceWeights.byKind, ...start.byKind } },
        learnedFormByShape: start.learnedFormByShape, assignedBy: "operator:fixture", reason: "start" });
      const startRevision = store.getRenderPolicy().revision;
      const importance = runImportanceLearningPass();
      const afterImportance = store.getRenderPolicy();
      const form = runFormLearningPass();
      if (form.changed) store.writeRenderPolicy({ learnedFormByShape: form.learnedFormByShape, assignedBy: FORM_LEARNER_ID, reason: form.reason });
      const end = store.getRenderPolicy();
      console.log(JSON.stringify({
        startRevision,
        importanceRevision: afterImportance.revision,
        importanceAssignedBy: afterImportance.assignedBy,
        learnerId: IMPORTANCE_LEARNER_ID,
        byKind: afterImportance.importanceWeights.byKind,
        reason: importance.pass.reason,
        formTable: end.learnedFormByShape,
        formReason: form.reason,
      }));
    `], { cwd: workspace, env: { ...process.env, WORKSPACE_ROOT: workspace } });
    if (child.exitCode !== 0) throw new Error(child.stderr.toString());
    const lines = child.stdout.toString().trim().split("\n");
    return JSON.parse(lines[lines.length - 1]!);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}

describe("a learned kind whose evidence is entirely provenance-excluded retires", () => {
  test("must-fail: the next revision drops a test kind with only excluded evidence, records why, and leaves live kinds unchanged", () => {
    const mixed = passFrom([...real, ...testOrigin]);
    const liveOnly = passFrom(real);
    expect(mixed.importanceRevision).toBeGreaterThan(mixed.startRevision);
    expect(mixed.importanceAssignedBy).toBe(mixed.learnerId);
    expect(mixed.byKind).not.toHaveProperty("learnerprobe_rising_1");
    expect(mixed.byKind).not.toHaveProperty("learnerprobe_refuse_25");
    expect(mixed.reason).toContain("Retired 2 kind(s) whose recorded evidence is entirely provenance-excluded");
    expect(mixed.reason).toContain("learnerprobe_rising_1");
    expect(mixed.reason).toContain("learnerprobe_refuse_25");
    // Live kinds: exactly where the same pass over the live lines alone puts them.
    expect(mixed.byKind.gap_needs_human).toBe(liveOnly.byKind.gap_needs_human);
    expect(mixed.byKind.unseen_live).toBe(3.25);
    // Form shapes, same rule: probe_shape's only evidence is excluded.
    expect(mixed.formTable).not.toHaveProperty("probe_shape");
    expect(mixed.formTable).toMatchObject({ unseen_shape: "text", real_shape: "text" });
    expect(mixed.formReason).toContain("Retired 1 shape(s) whose recorded evidence is entirely provenance-excluded: probe_shape");
  });

  test("must-fail: a corpus holding only excluded lines still retires through the learner's write", () => {
    const leakedOnly = passFrom(testOrigin);
    expect(leakedOnly.importanceRevision).toBeGreaterThan(leakedOnly.startRevision);
    expect(leakedOnly.importanceAssignedBy).toBe(leakedOnly.learnerId);
    expect(Object.keys(leakedOnly.byKind).filter(k => k === "learnerprobe_rising_1" || k === "learnerprobe_refuse_25")).toEqual([]);
    expect(leakedOnly.byKind.gap_needs_human).toBe(4);
  });

  test("control: an unseen kind, live or test-named, stays byte-identical", () => {
    for (const run of [passFrom(real), passFrom([...real, ...testOrigin])]) {
      expect(run.byKind.unseen_live).toBe(3.25);
      expect(run.byKind.learnerprobe_unseen_9).toBe(2);
      expect(run.formTable.unseen_shape).toBe("text");
    }
    // With no excluded evidence, nothing retires: the test kinds are merely unseen.
    const liveOnly = passFrom(real);
    expect(liveOnly.byKind.learnerprobe_rising_1).toBe(7.5);
    expect(liveOnly.byKind.learnerprobe_refuse_25).toBe(9.5);
    expect(liveOnly.formTable.probe_shape).toBe("text");
  });
});

/*
 * PANEL PROVENANCE (gap panel-records-carry-no-provenance-stamp-so-test-panels-are-excluded-by-name).
 * The browser's acts on a leaked test panel are stamped, so only the PANEL can say the
 * act is about a test. A panel carries the same origin/producer stamp its writer sends,
 * and the learner reads that stamp instead of the kind's name. Once any panel carries
 * the stamp, an unstamped panel written after it is test-origin. A legacy panel (written
 * before any panel carried the stamp) is test-origin when an unstamped exposure record
 * names it: the leaked runs ticked every panel they seeded with their own unstamped ticks.
 */
const writer = { origin: "machine", producer: "development-vessel/ui-write-passthrough" };
const panel = (id: string, kind: string, createdAt: number, stampOf: Record<string, string> | null) => ({
  id, title: `panel ${id}`, body: { text: "x" }, kind, importance: "high",
  asks: [{ id: "q", prompt: "?", type: "text" }], visibility: "public", revision: 1, createdAt, updatedAt: createdAt,
  ...(stampOf ?? {}),
});
const stampedTick = (ids: string[]) => ({ type: "exposure", visibility: "operator_only", scanStatus: "observed", panelKind: null,
  observedAt: at + 100, body: { ...stamp, renderer_bundle: "index-real.js", visible_in_viewport: ids.map((panel_id, i) => ({ panel_id, rank: i + 1 })) } });
const stampedAnswer = (panelId: string, panelKind: string, i: number) => ({ type: "exposure_outcome", panelId, visibility: "operator_only",
  outcome: "answered", outcomeScope: "panel", exposureCount: 2, inferred: false, panelKind, observedAt: at + 110 + i,
  body: { ...stamp, renderer_bundle: "index-real.js" } });

describe("a test panel is excluded by its provenance stamp, not by its kind's name", () => {
  test("must-fail: an unstamped panel written after panels carry the stamp is test-origin, whatever its kind", () => {
    const panels = [
      panel("live-1", "gap_needs_human", at, writer),
      panel("probe-1", "ordinary_kind", at + 2, null),
    ];
    const run = passOver([stampedTick(["live-1", "probe-1"]), stampedAnswer("live-1", "gap_needs_human", 0), stampedAnswer("probe-1", "ordinary_kind", 1)], panels);
    expect(run.evidenceKinds).toEqual(["gap_needs_human"]);
    expect(run.reason).toContain("1 stamped outcome(s) on a test-origin panel");
  });

  test("must-fail: a legacy panel an unstamped exposure record names is test-origin, whatever its kind", () => {
    const panels = [panel("legacy-live", "live_legacy", at, null), panel("legacy-probe", "other_kind", at + 1, null)];
    const leakedTick = { type: "exposure", visibility: "operator_only", scanStatus: "observed", panelKind: null, observedAt: at + 50,
      body: { visible_in_viewport: [{ panel_id: "legacy-probe", rank: 1 }], renderer_bundle: "test-bundle", tick_seq: 1 } };
    const run = passOver([leakedTick, stampedTick(["legacy-live", "legacy-probe"]),
      stampedAnswer("legacy-live", "live_legacy", 0), stampedAnswer("legacy-probe", "other_kind", 1)], panels);
    expect(run.evidenceKinds).toEqual(["live_legacy"]);
    expect(run.reason).toContain("1 stamped outcome(s) on a test-origin panel");
  });

  test("must-fail: a stamped live panel whose kind starts with learnerprobe_ is kept", () => {
    const panels = [panel("live-lp", "learnerprobe_live", at, writer)];
    const run = passOver([stampedTick(["live-lp"]), stampedAnswer("live-lp", "learnerprobe_live", 0)], panels);
    expect(run.evidenceKinds).toEqual(["learnerprobe_live"]);
  });

  test("must-fail: a panel write through the route keeps the writer's stamp", () => {
    const workspace = mkdtempSync(join(tmpdir(), "human-surface-panel-stamp-"));
    try {
      const routerModule = new URL("../src/routes/impulses.ts", import.meta.url).pathname;
      const child = Bun.spawnSync([process.execPath, "-e", `
        const { impulsesRouter } = await import(${JSON.stringify(routerModule)});
        const post = async (pointer) => (await impulsesRouter.request("/v2/impulses/resolve", {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pointer }) })).json();
        const created = await post({ type: "uiQuestion_write", id: "stamped-q", title: "t", body: "b", kind: "question", ...${JSON.stringify(writer)} });
        // An update that does not restate the stamp keeps the creator's.
        const updated = await post({ type: "uiQuestion_write", id: "stamped-q", title: "t2" });
        const plain = await post({ type: "uiQuestion_write", id: "plain-q", title: "t", body: "b", kind: "question" });
        console.log(JSON.stringify({ created: created.body, updated: updated.body, plain: plain.body }));
      `], { cwd: workspace, env: { ...process.env, WORKSPACE_ROOT: workspace } });
      expect(child.exitCode).toBe(0);
      const out = JSON.parse(child.stdout.toString().trim().split("\n").pop()!);
      expect(out.created).toMatchObject(writer);
      expect(out.updated).toMatchObject({ ...writer, title: "t2" });
      expect(out.plain.origin).toBeUndefined();
      expect(out.plain.producer).toBeUndefined();
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  test("control: a legacy panel no unstamped record names still counts", () => {
    const run = passOver([stampedTick(["legacy-live"]), stampedAnswer("legacy-live", "live_legacy", 0)],
      [panel("legacy-live", "live_legacy", at, null)]);
    expect(run.evidenceKinds).toEqual(["live_legacy"]);
  });
});
