/**
 * The deployed tree is src/ + ui/dist (pull-sync mirrors src/, sql/, scripts/
 * and tracked build output). A server module that imports from ui/src starts
 * here and crashes there: 41dfb53 did, and both nodes reverted it.
 */
import { describe, expect, test } from "bun:test";
import { Glob } from "bun";

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
