/**
 * How long the surface waits on a read is a field of the render policy (`timeouts`), read at
 * use time, bounded, and never longer than the server's idle timeout allows (law 1; tasks 2.3,
 * third group: read timeouts).
 */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DEFAULT_TIMEOUTS } from "../src/timeouts.ts";

const storeModule = new URL("../src/store.ts", import.meta.url).pathname;
const routerModule = new URL("../src/routes/impulses.ts", import.meta.url).pathname;
const proxyModule = new URL("../src/routes/proxy.ts", import.meta.url).pathname;

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
  const ok = await write({ timeouts: { resolveMs: 3000 } });
  const unbounded = await write({ timeouts: { shapesMs: null } });
  const tooLong = await write({ timeouts: { issuesMs: 60000 } });
  console.log(JSON.stringify({ ok: ok.status, unbounded: unbounded.status, tooLong: tooLong.status,
    rejected: [...unbounded.body.rejected_values, ...tooLong.body.rejected_values], timeouts: store.getRenderPolicy().timeouts }));
`;
const REPLAY = `
  const store = await import(${JSON.stringify(storeModule)});
  console.log(JSON.stringify({ timeouts: store.getRenderPolicy().timeouts }));
`;
/** A gap store that answers after 1.5 s; the policy says to wait 0.5 s. */
const SLOW = `
  const server = Bun.serve({ port: 0, async fetch() {
    await new Promise((r) => setTimeout(r, 1500));
    return Response.json({ body: { gaps: [{ id: "g-1", status: "open" }] } });
  } });
  process.env.DISCOVERY_ENDPOINT = "http://127.0.0.1:" + server.port;
  process.env.DISCOVERY_VESSEL_ENDPOINT = "http://127.0.0.1:" + server.port;
  const store = await import(${JSON.stringify(storeModule)});
  const { readGapById } = await import(${JSON.stringify(proxyModule)});
  store.writeRenderPolicy({ timeouts: { gapStatusMs: 500 } });
  const t0 = Date.now();
  const answer = await readGapById("g-1");
  const waited = Date.now() - t0;
  server.stop(true);
  console.log(JSON.stringify({ answer, waited }));
`;

function run(script: string, workspace: string): Record<string, unknown> {
  const child = Bun.spawnSync([process.execPath, "-e", script], { env: { ...process.env, WORKSPACE_ROOT: workspace } });
  if (child.exitCode !== 0) throw new Error(child.stderr.toString());
  return JSON.parse(child.stdout.toString().trim().split("\n").pop()!) as Record<string, unknown>;
}

function inWorkspace(f: (workspace: string) => void): void {
  const workspace = mkdtempSync(join(tmpdir(), "human-surface-timeouts-"));
  try {
    f(workspace);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}

describe("timeouts is a policy field", () => {
  test("must-fail: a write moves only the keys it names, refuses no-limit and past-the-ceiling, and survives a restart", () => {
    inWorkspace((workspace) => {
      const w = run(WRITE, workspace);
      expect([w["ok"], w["unbounded"], w["tooLong"]]).toEqual([200, 422, 422]);
      expect(w["rejected"]).toEqual([
        "timeouts.shapesMs must be an integer from 500 to 25000",
        "timeouts.issuesMs must be an integer from 500 to 25000",
      ]);
      expect(w["timeouts"]).toEqual({ ...DEFAULT_TIMEOUTS, resolveMs: 3000 });
      expect(run(REPLAY, workspace)["timeouts"]).toEqual(w["timeouts"]);
    });
  });

  test("must-fail: a read waits as long as the policy in force says, not longer", () => {
    inWorkspace((workspace) => {
      const r = run(SLOW, workspace);
      expect(r["answer"]).toBeNull();
      expect(r["waited"] as number).toBeLessThan(1200);
    });
  });
});
