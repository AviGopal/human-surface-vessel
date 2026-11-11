/**
 * How often the surface looks again is a field of the render policy (`recheck`), read at use
 * time, not a constant (law 1; tasks 2.3, first group: caches and recheck intervals).
 *
 * The policy write runs in a fresh subprocess against a disposable workspace, so its journal
 * and the replay are this test's own.
 */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DEFAULT_RECHECK, RECHECK_KEYS, recheckOf, recheckPatch } from "../src/recheck.ts";

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
  const ok = await write({ recheck: { gapStatusTtlMs: 20000, liveMs: 5000 }, assignedBy: "test" });
  const junk = await write({ recheck: { liveMs: 1, nope: 3 } });
  const partial = await write({ recheck: { liveMs: 4000 } });
  console.log(JSON.stringify({ ok: ok.status, junk: junk.status, rejected: junk.body.rejected_values, partial: partial.status, recheck: store.getRenderPolicy().recheck }));
`;
const REPLAY = `
  const store = await import(${JSON.stringify(storeModule)});
  console.log(JSON.stringify({ recheck: store.getRenderPolicy().recheck }));
`;

function run(script: string, workspace: string): Record<string, unknown> {
  const child = Bun.spawnSync([process.execPath, "-e", script], { env: { ...process.env, WORKSPACE_ROOT: workspace } });
  if (child.exitCode !== 0) throw new Error(child.stderr.toString());
  return JSON.parse(child.stdout.toString().trim().split("\n").pop()!) as Record<string, unknown>;
}

describe("recheck is a policy field", () => {
  test("must-fail: a write moves only the keys it names, refuses junk by name, and survives a restart", () => {
    const workspace = mkdtempSync(join(tmpdir(), "human-surface-recheck-"));
    try {
      const w = run(WRITE, workspace);
      expect(w["ok"]).toBe(200);
      expect(w["junk"]).toBe(422);
      expect(w["rejected"]).toEqual([
        "recheck.liveMs must be an integer from 500 to 600000",
        "recheck.nope is not read; the keys are " + RECHECK_KEYS.join(", "),
      ]);
      expect(w["partial"]).toBe(200);
      expect(w["recheck"]).toEqual({ ...DEFAULT_RECHECK, gapStatusTtlMs: 20000, liveMs: 4000 });
      expect(run(REPLAY, workspace)["recheck"]).toEqual(w["recheck"]);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  test("a stored or served value outside its range reads as its default", () => {
    expect(recheckOf({ liveMs: 1, sessionMs: 30000, extra: 5 })).toEqual({ ...DEFAULT_RECHECK, sessionMs: 30000 });
    expect(recheckOf(undefined)).toEqual(DEFAULT_RECHECK);
    expect(recheckPatch(undefined, [])).toBeUndefined();
  });
});

/**
 * Every numeric constant in the source is named here, in the list that says why it is still a
 * constant. The last 2.3 commit empties PENDING; the debts are each owned elsewhere.
 */
const BOOTSTRAP = new Set([
  // The server's idle timeout and discovery registration: the proposal's bootstrap tier.
  "SERVER_IDLE_TIMEOUT_S", "REREGISTER_INTERVAL_MS", "DEREGISTER_TIMEOUT_MS",
  // A unit, not a behaviour.
  "MS_PER_DAY",
  // The default of a field already shaped (`visibleSliceSize`), named so readers share it.
  "DEFAULT_VISIBLE_SLICE_SIZE",
]);
/**
 * Law-1 debt: auth limits are constants. Their proper home is an owner-role row read at use
 * time, writable only by the owner credential, never by surfaceIntent.
 */
const DEBT_AUTH = new Set([
  "LOGIN_FAILURES_PER_WINDOW", "LOGIN_WINDOW_MS", "MAX_SESSIONS", "KEY_SESSION_MS",
  "CREDENTIAL_VALIDATION_TTL_MS", "CREDENTIAL_CACHE_MAX_ENTRIES",
]);
/** Learner and parser thresholds: they become activity input when the learners leave (3.2, 3.3). */
const DEBT_LEARNERS = new Set([
  "FORM_OBSERVATION_FLOOR", "PRIOR_ALPHA", "PRIOR_BETA", "CENSUS_WINDOW", "RECENT_BRIEFS_MAX",
  "TEXT_MIN_PX", "TEXT_MAX_PX", "SPACE_MIN_PX", "SPACE_MAX_PX", "VIEW_ASK_MAX",
]);
/** The 2.3 groups not yet shaped: page and list limits, then read timeouts. */
const PENDING = new Set([
  "PARTICIPATION_MAX_VALUE_CHARS", "GAP_STATUS_CONCURRENCY", "GAP_STATUS_MAX_PER_READ", "SURFACE_INTENT_MAX_CHARS",
  "FRAME_MAX_BYTES", "FRAME_MAX_ENTRIES", "MAX_HISTORY", "MAX_ENTRIES", "MAX_SHOW", "MAX_BOX_LINES",
  "SCALAR_MAX_CHARS", "RECORD_MAX_DEPTH", "FIELDS_SHOWN", "ITEMS_NAMED", "PREVIEW_CAP", "CELL_TITLE_CAP",
  "DISCOVERY_RESOLVE_TIMEOUT_MS", "SHAPES_TIMEOUT_MS",
]);

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !name.endsWith(".d.ts") ? [path] : [];
  });
}
const root = new URL("..", import.meta.url).pathname;
const files = [...sources(join(root, "src")), ...sources(join(root, "ui/src"))];

describe("no behaviour constant outside the named lists", () => {
  test("must-fail: every numeric constant is bootstrap, a named debt or pending", () => {
    const found = new Set<string>();
    for (const f of files) {
      for (const m of readFileSync(f, "utf8").matchAll(/^(?:export )?const ([A-Z][A-Z0-9_]+)\s*(?::[^=]+)?=\s*[0-9][0-9_]*(?:\s*\*\s*[0-9_]+)*\s*;/gm)) {
        found.add(m[1]!);
      }
    }
    const unnamed = [...found].filter((n) => !BOOTSTRAP.has(n) && !DEBT_AUTH.has(n) && !DEBT_LEARNERS.has(n) && !PENDING.has(n));
    expect(unnamed).toEqual([]);
  });

  test("must-fail: no reader polls on a number of its own", () => {
    const fixed = files.flatMap((f) =>
      [...readFileSync(f, "utf8").matchAll(/refetchInterval:\s*[\d_]+|Math\.max\((?:opts\.)?intervalMs,\s*[\d_]+/g)].map((m) => `${f.slice(root.length)}: ${m[0]}`),
    );
    expect(fixed).toEqual([]);
  });
});
