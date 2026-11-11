/**
 * The deployed tree is src/ + ui/dist (pull-sync mirrors src/, sql/, scripts/
 * and tracked build output). A server module that imports from ui/src starts
 * here and crashes there: 41dfb53 did, and both nodes reverted it.
 *
 * And the page a person gets is the tracked ui/dist, not ui/src: 825ed23 and 55979af changed
 * ui/src, committed no build, and installed only their server halves. The page kept guessing
 * readers from question ids after the server stopped.
 */
import { describe, expect, test } from "bun:test";
import { Glob } from "bun";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DIGEST_FILE, sourceDigest } from "../ui/source-digest.ts";

const root = new URL("..", import.meta.url).pathname;

describe("server modules", () => {
  test("must-fail: none imports from ui/ (only ui/dist is deployed, and it is read as files)", async () => {
    const offenders: string[] = [];
    for await (const file of new Glob("src/**/*.ts").scan(root)) {
      const text = await Bun.file(root + file).text();
      for (const m of text.matchAll(/^\s*(?:import|export)\s[^;]*?from\s+["']([^"']+)["']/gm)) {
        if (/(^|\/)ui\//.test(m[1]!)) offenders.push(`${file}: ${m[1]}`);
      }
      for (const m of text.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g)) {
        if (/(^|\/)ui\//.test(m[1]!)) offenders.push(`${file}: ${m[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

const ui = join(root, "ui");
const viteBin = join(ui, "node_modules/.bin/vite");

describe("the page's bundle", () => {
  // Needs no toolchain, so it runs at a node's install gate too: the build wrote this digest of
  // its inputs, and a change to any input since then reads as a bundle not shipped.
  test("must-fail: the tracked ui/dist was built from the tracked ui sources", () => {
    const digestPath = join(ui, "dist", DIGEST_FILE);
    expect(existsSync(digestPath)).toBe(true);
    expect(readFileSync(digestPath, "utf8").trim()).toBe(sourceDigest(ui));
  });

  // Skips only where the ui toolchain is not installed; a checkout that can build must compare.
  test.skipIf(!existsSync(viteBin))("must-fail: the tracked ui/dist is the build of ui/src as committed", () => {
    const out = mkdtempSync(join(tmpdir(), "human-surface-dist-"));
    try {
      const built = Bun.spawnSync([viteBin, "build", "--config", "vite.config.ts", "--outDir", out, "--emptyOutDir", "--logLevel", "error"], { cwd: ui, env: { ...process.env, NODE_ENV: "production" } });
      expect(built.stderr.toString()).toBe("");
      expect(built.exitCode).toBe(0);
      const names = (dir: string) => readdirSync(join(dir, "assets")).sort();
      expect(names(join(ui, "dist"))).toEqual(names(out));
      expect(readFileSync(join(ui, "dist/index.html"), "utf8")).toBe(readFileSync(join(out, "index.html"), "utf8"));
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }, 120_000);
});
