/**
 * Every service on a node uses the node's key; no vessel has a key of its own. A person's
 * rows are written under the person's key, never the node's (person-key tests cover that).
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const src = new URL("../src/", import.meta.url).pathname;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sources(p);
    return name.endsWith(".ts") && !name.endsWith(".d.ts") ? [p] : [];
  });
}

describe("the node's key only", () => {
  test("must-fail: no source reads a vessel-specific key variable", () => {
    const hits = sources(src).flatMap((f) => {
      const text = readFileSync(f, "utf8");
      return [...text.matchAll(/process\.env\.([A-Z0-9_]*API_KEY)\b/g)].map((m) => m[1]!).filter((name) => name !== "METABOB_API_KEY").map((name) => `${f.slice(src.length)}: ${name}`);
    });
    expect(hits).toEqual([]);
  });
});
