/**
 * The surface's own pages carry a Content-Security-Policy (prerequisite of the
 * person sign-in, user ruling 10-19): a token kept in the browser is only as safe
 * as the scripts that can run beside it. The shell, its assets and the API all
 * answer with it; markup drawn as a page keeps its own, stricter policy inside
 * its sandboxed frame.
 */
import { describe, expect, test } from "bun:test";
import { app } from "../src/index.ts";

const POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "connect-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "media-src 'self' data:",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
];

function directives(header: string | null): string[] {
  return (header ?? "").split(";").map((d) => d.trim()).filter(Boolean);
}

describe("Content-Security-Policy", () => {
  test("must-fail: the shell, an unknown route's shell and the API answer with the policy", async () => {
    for (const path of ["/", "/run/some-id", "/health", "/api/render-policy"]) {
      const r = await app.request(path);
      expect([path, directives(r.headers.get("content-security-policy")).sort()]).toEqual([path, [...POLICY].sort()]);
    }
  });

  test("the policy never allows inline or evaluated script", async () => {
    const r = await app.request("/");
    const h = r.headers.get("content-security-policy") ?? "";
    const script = directives(h).find((d) => d.startsWith("script-src")) ?? "";
    expect(script).toBe("script-src 'self'");
    expect(h).not.toContain("unsafe-eval");
  });
});
