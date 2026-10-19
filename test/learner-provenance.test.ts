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
function passOver(records: readonly unknown[]): any {
  const workspace = mkdtempSync(join(tmpdir(), "human-surface-provenance-"));
  try {
    mkdirSync(join(workspace, "interactor-log"));
    writeFileSync(join(workspace, "interactor-log", "interactorObservation_write.jsonl"),
      records.map(r => JSON.stringify(r)).join("\n") + "\n");
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
