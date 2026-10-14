/**
 * Every test run gets a throwaway workspace, however it is started. On 09-22 a
 * bare `bun test test/importance-learn.test.ts` inside the container (no
 * --preload) wrote 338 probe weights into the live render policy, and the
 * importance learner carried them forward as its anchor for three weeks.
 * bunfig.toml preloads test/setup.ts for every runner; this checks it took.
 */
import { describe, expect, test } from "bun:test";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";

describe("test workspace", () => {
  test("must-fail: a bare run sees a temporary WORKSPACE_ROOT, never the live /workspace", () => {
    const root = process.env.WORKSPACE_ROOT;
    expect(root).toBeDefined();
    expect(root).not.toBe("/workspace");
    expect(realpathSync(root!).startsWith(realpathSync(tmpdir()))).toBe(true);
  });
});
