/**
 * Every test run gets a throwaway workspace, however it is started. On 09-22 a
 * bare `bun test test/importance-learn.test.ts` inside the container (no
 * --preload) wrote 338 probe weights into the live render policy, and the
 * importance learner carried them forward as its anchor for three weeks.
 * bunfig.toml preloads test/setup.ts for every runner; this checks it took.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("test workspace", () => {
  test("must-fail: a bare run sees a temporary WORKSPACE_ROOT, never the live /workspace", () => {
    const root = process.env.WORKSPACE_ROOT;
    expect(root).toBeDefined();
    expect(root).not.toBe("/workspace");
    expect(realpathSync(root!).startsWith(realpathSync(tmpdir()))).toBe(true);
  });

  /*
   * bunfig.toml is read from the CWD only. A runner that starts `bun test` anywhere
   * but this repo's root (a super-repo checkout running repos/human-surface-vessel/...,
   * any parent directory) skips the preload, and participation.test.ts then appended
   * its 501 "other-question" feedback records per run to whatever WORKSPACE_ROOT the
   * runner carried: on a live node, the participation corpus the learners read.
   *
   * The sentinel stands in for that live root. It is what the child inherits, and
   * the assertion reads the directory participation-journal.ts would resolve under
   * it, not anything the test file reports about itself.
   */
  test("must-fail: participation.test.ts started outside this repo's root leaves the inherited WORKSPACE_ROOT untouched", () => {
    const sentinel = mkdtempSync(join(tmpdir(), "human-surface-live-sentinel-"));
    const elsewhere = mkdtempSync(join(tmpdir(), "human-surface-foreign-cwd-"));
    try {
      const file = new URL("./participation.test.ts", import.meta.url).pathname;
      const child = Bun.spawnSync([process.execPath, "test", file, "--timeout", "60000"], {
        cwd: elsewhere,
        env: { ...process.env, WORKSPACE_ROOT: sentinel },
      });
      const output = child.stdout.toString() + child.stderr.toString();
      // Its own assertions still pass, against the test-scoped journal.
      expect(output).toMatch(/\b0 fail\b/);
      expect(child.exitCode).toBe(0);
      const journal = join(sentinel, "interactor-log", "uiFeedback_write.jsonl");
      const appended = existsSync(journal)
        ? readFileSync(journal, "utf8").split("\n").filter(line => line.trim()).length
        : 0;
      expect(appended).toBe(0);
      expect(existsSync(join(sentinel, "interactor-log"))).toBe(false);
    } finally {
      rmSync(sentinel, { recursive: true, force: true });
      rmSync(elsewhere, { recursive: true, force: true });
    }
  }, 180_000);

  // CONTROL: the redirect is the test's, not the vessel's. Production code started
  // with no test preload still writes the journal under the WORKSPACE_ROOT it is given.
  test("control: the store outside a test writes its feedback under the configured WORKSPACE_ROOT", () => {
    const root = mkdtempSync(join(tmpdir(), "human-surface-production-root-"));
    try {
      const module = new URL("../src/store.ts", import.meta.url).pathname;
      const child = Bun.spawnSync([process.execPath, "-e", `
        const store = await import(${JSON.stringify(module)});
        store.recordFeedback({ panelId: "control-panel", kind: "answer", value: "kept" });
      `], { cwd: root, env: { ...process.env, WORKSPACE_ROOT: root } });
      expect(child.exitCode).toBe(0);
      const lines = readFileSync(join(root, "interactor-log", "uiFeedback_write.jsonl"), "utf8")
        .split("\n").filter(line => line.trim());
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0]!).pointer.panel_id).toBe("control-panel");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
