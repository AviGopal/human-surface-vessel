/**
 * FALSIFIER for renderPolicy durability, attribution, and refusal (Track B item B-5).
 *
 * Three defects, measured on the unmodified vessel before this file existed:
 *
 *  (a) DURABILITY — `renderPolicy` lived in a module-level variable that no journal
 *      channel replayed, so every assignment (including any learned importance
 *      weight) was lost on restart. Asserted here by writing in ONE process and
 *      reading back in a SECOND, the way test/journal-envelope.test.ts (c) does:
 *      a claim that the system learned cannot rest on state that evaporates.
 *
 *  (b) ATTRIBUTION — `RenderPolicy` had no field for the author or the rationale of
 *      an assignment, so a render change could not name who made it or why. An
 *      assignment that cannot name its author supports no causal claim.
 *
 *  (c) REFUSAL — `writeRenderPolicy` advanced `revision` unconditionally, and the
 *      route read only specific TOP-LEVEL pointer keys, so a caller sending a nested
 *      `policy` object got 200, a bumped revision, and nothing recorded. That is the
 *      exact pointer validation/human-participation/stage4-trace.ts:62-65 sends, and
 *      it is why TRACE-2026-09-20.md records link 2 as MISSING. A write that moved no
 *      field must refuse — non-2xx, revision unchanged, naming the keys it accepts —
 *      following the surfaceIntent unparsed-clause precedent in this same vessel
 *      (src/routes/impulses.ts:485-510: nothing moved, so nothing is written, the
 *      revision does not advance, and the caller is told what the parser does read).
 */
import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { impulsesRouter } from "../src/routes/impulses.ts";

const storeModule = new URL("../src/store.ts", import.meta.url).pathname;
const routerModule = new URL("../src/routes/impulses.ts", import.meta.url).pathname;

async function resolve(pointer: Record<string, unknown>) {
  const res = await impulsesRouter.request("/v2/impulses/resolve", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pointer }),
  });
  return { status: res.status, json: (await res.json()) as any };
}

/** Run a script in a FRESH bun process against `workspace`, so nothing is inherited in memory. */
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

const policyJournalLines = (workspace: string): number => {
  const file = join(workspace, "interactor-log", "renderPolicy_write.jsonl");
  if (!existsSync(file)) return 0;
  return readFileSync(file, "utf8").split("\n").filter(l => l.trim()).length;
};

describe("renderPolicy is durable, attributable, and refuses a write that moves nothing", () => {
  test("(a+b) an assignment with its author and reason survives a restart", () => {
    const workspace = mkdtempSync(join(tmpdir(), "human-surface-policy-"));
    try {
      // PROCESS 1 — the assignment, made through the real route.
      const writer = inFreshProcess(workspace, `
        const { impulsesRouter } = await import(${JSON.stringify(routerModule)});
        const res = await impulsesRouter.request("/v2/impulses/resolve", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ pointer: {
            type: "renderPolicy_write",
            presentation: "stacked",
            note: "durability falsifier",
            maxPreviewChars: 321,
            assignedBy: "operator:avi",
            reason: "stage-4 trace; v2 is the only deployed candidate — no experiment, no randomization",
          } }),
        });
        console.log(JSON.stringify({ status: res.status, body: (await res.json()).body }));
      `);
      expect(writer.stderr + writer.stdout).not.toContain("ReferenceError");
      expect(writer.exitCode).toBe(0);
      const written = JSON.parse(writer.stdout.trim().split("\n").pop()!);
      expect(written.status).toBe(200);
      expect(written.body.assignedBy).toBe("operator:avi");
      expect(written.body.reason).toContain("no experiment, no randomization");
      const revision = written.body.revision;
      expect(revision).toBeGreaterThan(0);

      // PROCESS 2 — a restart. Nothing is in memory; only the journal can carry this.
      const reader = inFreshProcess(workspace, `
        const store = await import(${JSON.stringify(storeModule)});
        console.log(JSON.stringify(store.getRenderPolicy()));
      `);
      expect(reader.exitCode).toBe(0);
      const restored = JSON.parse(reader.stdout.trim().split("\n").pop()!);
      expect(restored.presentation).toBe("stacked");
      expect(restored.note).toBe("durability falsifier");
      expect(restored.maxPreviewChars).toBe(321);
      expect(restored.assignedBy).toBe("operator:avi");
      expect(restored.reason).toContain("no experiment, no randomization");
      // The revision is content identity, so a replay must not invent a new one.
      expect(restored.revision).toBe(revision);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  test("(b) attribution is not inherited — a later write that omits the author says so", () => {
    const workspace = mkdtempSync(join(tmpdir(), "human-surface-policy-attr-"));
    try {
      const out = inFreshProcess(workspace, `
        const store = await import(${JSON.stringify(storeModule)});
        const first = store.writeRenderPolicy({ presentation: "stacked", assignedBy: "activity:variant_select", reason: "arm B" });
        const second = store.writeRenderPolicy({ presentation: "onepage" });
        console.log(JSON.stringify([first, second]));
      `);
      expect(out.exitCode).toBe(0);
      const [first, second] = JSON.parse(out.stdout.trim().split("\n").pop()!);
      expect(first.policy.assignedBy).toBe("activity:variant_select");
      // Carrying the previous author onto a revision they did not write is FALSE
      // attribution, which is worse than an honest null.
      expect(second.policy.assignedBy).toBeNull();
      expect(second.policy.reason).toBeNull();
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  test("(c) a write that moves no field is refused: non-2xx, revision unchanged, nothing journaled", async () => {
    const workspace = process.env.WORKSPACE_ROOT!;
    const unique = `no-op falsifier ${crypto.randomUUID()}`;
    const first = await resolve({ type: "renderPolicy_write", note: unique, maxPreviewChars: 777 });
    expect(first.status).toBe(200);
    const revision = first.json.body.revision;
    const linesBefore = policyJournalLines(workspace);

    // The identical write again. Nothing can move.
    const repeat = await resolve({ type: "renderPolicy_write", note: unique, maxPreviewChars: 777 });
    expect(repeat.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(repeat.json)).toContain("maxPreviewChars"); // names what it accepts
    const readBack = await resolve({ type: "renderPolicy" });
    expect(readBack.json.body.revision).toBe(revision);
    expect(policyJournalLines(workspace)).toBe(linesBefore);
  });

  test("(c) the nested `policy` pointer the stage-4 trace sends is refused, not hollow-accepted", async () => {
    const before = await resolve({ type: "renderPolicy" });
    // VERBATIM the pointer at validation/human-participation/stage4-trace.ts:62-65.
    const nested = await resolve({
      type: "renderPolicy_write",
      policy: {
        presentation_version: "repertoire-v2-onepage",
        parent: "repertoire-v1",
        assigned_by: "operator:avi",
        reason: "stage-4 trace; v2 is the only deployed candidate — no experiment, no randomization",
      },
    });
    expect(nested.status).toBeGreaterThanOrEqual(400);
    const said = JSON.stringify(nested.json);
    // It must say WHAT IT COULD NOT READ, not merely that it failed.
    expect(said).toContain("policy");
    expect(said).toContain("presentation");
    const after = await resolve({ type: "renderPolicy" });
    expect(after.json.body.revision).toBe(before.json.body.revision);
  });
});
