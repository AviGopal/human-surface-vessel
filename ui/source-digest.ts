/**
 * A digest of everything the page's bundle is built from, written into ui/dist by the build and
 * recomputed by test/deployed-tree.test.ts with no toolchain, so a ui/src change that ships no
 * bundle fails wherever the suite runs, including a node's install gate (which has no vite).
 *
 * Inputs: every file under ui/src, the build's own files, and the server modules the page imports
 * (src/question-class.ts and the like), followed through their relative imports.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

export const DIGEST_FILE = ".source-digest";

const BUILD_FILES = ["index.html", "vite.config.ts", "package.json", "bun.lock", "tsconfig.json", "source-digest.ts"];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

function resolveImport(from: string, spec: string): string | null {
  const base = resolve(dirname(from), spec);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** The digest of the page's build inputs under `uiDir`, as hex. */
export function sourceDigest(uiDir: string): string {
  const root = resolve(uiDir, "..");
  const files = new Set([...walk(join(uiDir, "src")), ...BUILD_FILES.map((f) => join(uiDir, f)).filter((f) => existsSync(f))]);
  const queue = [...files];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (!/\.tsx?$/.test(file)) continue;
    for (const m of readFileSync(file, "utf8").matchAll(/(?:from|import)\s*\(?\s*["'](\.{1,2}\/[^"']+)["']/g)) {
      const target = resolveImport(file, m[1]!);
      if (target && !files.has(target)) {
        files.add(target);
        queue.push(target);
      }
    }
  }
  const hash = createHash("sha256");
  for (const file of [...files].map((f) => relative(root, f)).sort()) {
    hash.update(`${file}\0`);
    hash.update(readFileSync(join(root, file)));
    hash.update("\0");
  }
  return hash.digest("hex");
}
