/**
 * How much the surface draws is a field of the render policy (`limits`), read at use time by
 * the server and the page (law 1; tasks 2.3, second group: page and list limits).
 */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DEFAULT_LIMITS } from "../src/limits.ts";

const storeModule = new URL("../src/store.ts", import.meta.url).pathname;
const routerModule = new URL("../src/routes/impulses.ts", import.meta.url).pathname;

const WRITE = `
  const store = await import(${JSON.stringify(storeModule)});
  const { impulsesRouter } = await import(${JSON.stringify(routerModule)});
  async function write(pointer) {
    const res = await impulsesRouter.request("/v2/impulses/resolve", {
      method: "POST", headers: { "content-type": "application/json", Authorization: "ApiKey " + process.env.METABOB_API_KEY },
      body: JSON.stringify({ pointer: { type: "renderPolicy_write", ...pointer } }),
    });
    return { status: res.status, body: await res.json() };
  }
  const ok = await write({ limits: { fieldsShown: 3, gapStatusConcurrency: 2 } });
  const junk = await write({ limits: { gapStatusConcurrency: 64 } });
  console.log(JSON.stringify({ ok: ok.status, junk: junk.status, rejected: junk.body.rejected_values, limits: store.getRenderPolicy().limits }));
`;
const REPLAY = `
  const store = await import(${JSON.stringify(storeModule)});
  console.log(JSON.stringify({ limits: store.getRenderPolicy().limits }));
`;

function run(script: string, workspace: string): Record<string, unknown> {
  const child = Bun.spawnSync([process.execPath, "-e", script], { env: { ...process.env, WORKSPACE_ROOT: workspace } });
  if (child.exitCode !== 0) throw new Error(child.stderr.toString());
  return JSON.parse(child.stdout.toString().trim().split("\n").pop()!) as Record<string, unknown>;
}

describe("limits is a policy field", () => {
  test("must-fail: a write moves only the keys it names, cannot flood a producer, and survives a restart", () => {
    const workspace = mkdtempSync(join(tmpdir(), "human-surface-limits-"));
    try {
      const w = run(WRITE, workspace);
      expect(w["ok"]).toBe(200);
      expect(w["junk"]).toBe(422);
      expect(w["rejected"]).toEqual(["limits.gapStatusConcurrency must be an integer from 1 to 8"]);
      expect(w["limits"]).toEqual({ ...DEFAULT_LIMITS, fieldsShown: 3, gapStatusConcurrency: 2 });
      expect(run(REPLAY, workspace)["limits"]).toEqual(w["limits"]);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});
