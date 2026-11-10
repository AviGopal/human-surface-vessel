/**
 * EVERY CALL TO ANOTHER VESSEL GOES THROUGH DISCOVERY. The surface holds no producer's
 * address and reads none out of a registry row; discovery places each call by shape.
 * The other outbound calls are to identity (key and sign-in checks) and discovery's own
 * register/deregister.
 *
 * ONE NAMED EXCEPTION: a person's verdict (the label write) is sent with the person's
 * on-behalf-of token, and discovery's /resolve admits only `ApiKey` credentials, so that
 * write still goes to the address the registry names (person-session.ts `labelProducer`).
 * It stays only until discovery forwards a person's token or a verdict becomes a row.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = new URL("../src/", import.meta.url).pathname;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? sources(p) : p.endsWith(".ts") ? [p] : [];
  });
}

const files = sources(SRC).map((p) => ({ file: p.slice(SRC.length), text: readFileSync(p, "utf8") }));

/** Where each outbound call may go: the base its URL is built on. */
const ALLOWED_FETCH: Array<{ file: string; target: RegExp }> = [
  { file: "routes/proxy.ts", target: /^fetch\(`\$\{DISCOVERY_ENDPOINT\.replace\(\/\\\/\+\$\/, ""\)\}\/resolve`/ },
  { file: "routes/proxy.ts", target: /^fetch\(`\$\{base\.replace\(\/\\\/\+\$\/, ""\)\}\/registry\/shapes`/ },
  { file: "routes/proxy.ts", target: /^fetch\(url,/ },
  { file: "routes/impulses.ts", target: /^fetch\(`\$\{DISCOVERY_ENDPOINT\.replace\(\/\\\/\+\$\/, ""\)\}\/resolve`/ },
  { file: "person-session.ts", target: /^fetch\(`\$\{DISCOVERY_ENDPOINT\.replace\(\/\\\/\+\$\/, ""\)\}\/resolve`/ },
  { file: "person-session.ts", target: /^fetch\(`\$\{IDENTITY_VESSEL_URL\.replace\(\/\\\/\+\$\/, ""\)\}\/v1\/auth\/(login|on-behalf-of)`/ },
  { file: "caller-credential.ts", target: /^fetch\(`\$\{base\}\/v1\/auth\/resolve`/ },
  { file: "discovery-registration.ts", target: /^fetch\(`\$\{DISCOVERY_ENDPOINT\}\/(register|vessels\/)/ },
];

describe("the surface calls other vessels only through discovery", () => {
  test("must-fail: every outbound fetch is to discovery or identity", () => {
    const strays: string[] = [];
    for (const { file, text } of files) {
      for (const m of text.matchAll(/(?<![\w.])fetch\([^\n]*/g)) {
        const call = m[0];
        if (!ALLOWED_FETCH.some((a) => a.file === file && a.target.test(call))) strays.push(`${file}: ${call.slice(0, 120)}`);
      }
    }
    expect(strays).toEqual([]);
  });

  test("must-fail: proxy's generic passthrough is sent only to discovery or the named label write", () => {
    const proxy = files.find((f) => f.file === "routes/proxy.ts")!.text;
    const targets = [...proxy.matchAll(/passthrough\(\{\s*url:\s*([^,\n]+),/g)].map((m) => m[1]!.trim());
    expect(targets.length).toBeGreaterThan(0);
    for (const t of targets) expect(t === "asPerson.url" || t.startsWith("`${DISCOVERY_ENDPOINT")).toBe(true);
  });

  test("must-fail: the registry's shapes are read from discovery alone", () => {
    const proxy = files.find((f) => f.file === "routes/proxy.ts")!.text;
    expect([...proxy.matchAll(/readShapesFrom\(([^)]*)\)/g)].map((m) => m[1]).filter((a) => !a!.startsWith("base:"))).toEqual(["DISCOVERY_ENDPOINT"]);
  });

  test("must-fail: no address is read from a registry row, except the named label write", () => {
    const reads: string[] = [];
    for (const { file, text } of files) {
      // The registration advertises this vessel's own address; that is a write, not a read.
      if (file === "discovery-registration.ts") continue;
      if (/resolve_endpoint|public_endpoint/.test(text)) reads.push(`${file}: resolve_endpoint/public_endpoint`);
      for (const m of text.matchAll(/\[\s*"endpoint"\s*\]|\.endpoint\b/g)) reads.push(`${file}: ${m[0]}`);
    }
    expect(reads).toEqual(['person-session.ts: ["endpoint"]']);
  });

  test("must-fail: no producer address is pinned in the environment or as a literal", () => {
    const pins: string[] = [];
    for (const { file, text } of files) {
      for (const m of text.matchAll(/GOAL_HOST_ENDPOINT|DEV_VESSEL_ENDPOINT|ACTIVITY_API_(ENDPOINT|URL)|FED_HEALTH_PORT/g)) pins.push(`${file}: ${m[0]}`);
      // The one address literal is discovery's own default, in the boot configuration.
      for (const m of text.matchAll(/(127\.0\.0\.1|localhost):\d+/g)) if (file !== "config.ts") pins.push(`${file}: ${m[0]}`);
    }
    expect(pins).toEqual([]);
  });
});
