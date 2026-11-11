/**
 * Nothing in the surface reads or writes what only goal-host served. Goal-host is not
 * returning, and depending on it was the antipattern (user ruling): asking is a records row,
 * watching is reading rows, a verdict is an `outcome` row. A question the walk puts to a
 * person arrives as `human_input`, which the surface itself serves.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("../", import.meta.url).pathname;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.tsx?$/.test(p) && !p.endsWith(".d.ts") ? [p] : [];
  });
}

const GOAL_HOST = /\b(goalDispatchAsync|goalWalkState|goalWalkOutput|activeDispatches|solicitationResponse_write|solicitationHeartbeat_write|poolImpulse_write|goal_verification_label_write)\b/g;
const ROUTES = /["'`]\/api\/(run-goal|mine|walk-output|resolve|executions|grade|gap-threads|verdicts|calibration)\b/g;

describe("goal-host is gone from the surface", () => {
  test("must-fail: no source names a goal-host shape", () => {
    const hits: string[] = [];
    for (const p of [...sources(join(ROOT, "src")), ...sources(join(ROOT, "ui/src"))]) {
      for (const m of readFileSync(p, "utf8").matchAll(GOAL_HOST)) hits.push(`${p.slice(ROOT.length)}: ${m[1]}`);
    }
    expect(hits).toEqual([]);
  });

  test("must-fail: no route or page call reaches a goal-host path", () => {
    const hits: string[] = [];
    for (const p of [...sources(join(ROOT, "src")), ...sources(join(ROOT, "ui/src"))]) {
      for (const m of readFileSync(p, "utf8").matchAll(ROUTES)) hits.push(`${p.slice(ROOT.length)}: /api/${m[1]}`);
    }
    expect(hits).toEqual([]);
  });
});
