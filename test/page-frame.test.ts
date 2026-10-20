/**
 * Markup drawn as a page is served from its own URL with its own policy, so the
 * surface's policy no longer has to allow what a page needs (user-approved
 * follow-up to the CSP, 10-19). The frame document refuses every fetch, runs no
 * script, is sandboxed even when opened on its own, and can be framed only by the
 * surface. It is a short-lived rendering cache: nothing is journaled.
 */
import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { app, CONTENT_SECURITY_POLICY, contentSecurityPolicy } from "../src/index.ts";
import { FRAME_POLICY } from "../src/page-frame.ts";
import { restoreNativeGlobals } from "./setup.ts";

// First: in one process an earlier file may have left happy-dom or a fetch stub installed (test/setup.ts).
await restoreNativeGlobals();

const SVG = '<svg width="100" height="100"><circle cx="50" cy="50" r="40"/></svg>';
const FRAME = ["default-src 'none'", "style-src 'unsafe-inline'", "img-src data:", "font-src data:", "media-src data:", "frame-ancestors 'self'", "sandbox"];
const directives = (h: string | null) => (h ?? "").split(";").map((d) => d.trim()).filter(Boolean).sort();

/** A browser session: the shell sets the frame cookie on first load. */
async function session(): Promise<string> {
  const r = await app.request("/");
  const set = r.headers.get("set-cookie") ?? "";
  expect(set).toContain("HttpOnly");
  expect(set).toContain("SameSite=Strict");
  expect(set).toContain("Path=/api/page-frame");
  return set.split(";")[0]!;
}

/** As the surface's page posts it: same-origin and keyless (src/inbound-auth.ts admits it as browser-unverified). */
async function post(source: unknown, cookie: string | null, origin = "http://localhost") {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (cookie) headers["cookie"] = cookie;
  if (origin) headers["origin"] = origin;
  const r = await app.request("/api/page-frame", { method: "POST", headers, body: JSON.stringify({ source }) });
  return { status: r.status, json: (await r.json().catch(() => ({}))) as { id?: string } };
}
const get = (id: string | undefined, cookie: string | null) => app.request(`/api/page-frame/${id}`, cookie ? { headers: { cookie } } : {});

describe("the page frame on its own URL", () => {
  test("must-fail: a posted page is served with the frame's own policy, not the surface's", async () => {
    const me = await session();
    const { status, json } = await post(SVG, me);
    expect(status).toBe(200);
    expect(json.id).toMatch(/^[0-9a-f]{64}$/);
    const r = await get(json.id, me);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(directives(r.headers.get("content-security-policy"))).toEqual([...FRAME].sort());
    expect(r.headers.get("referrer-policy")).toBe("no-referrer");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    const doc = await r.text();
    expect(doc).toContain(SVG);
    expect(doc.indexOf("Content-Security-Policy")).toBeLessThan(doc.indexOf("<svg"));
  });

  test("must-fail: the id is random and belongs to the session that posted it", async () => {
    const me = await session();
    const other = await session();
    const mine = (await post(SVG, me)).json.id;
    const theirs = (await post(SVG, other)).json.id;
    expect(mine).not.toBe(theirs);
    expect(mine).not.toBe(new Bun.CryptoHasher("sha256").update(SVG).digest("hex"));
    expect((await post(SVG, me)).json.id).toBe(mine);
    expect((await get(mine, other)).status).toBe(404);
    expect((await get(mine, null)).status).toBe(404);
  });

  test("must-fail: a write without a frame session or from another site is refused", async () => {
    expect((await post(SVG, null)).status).toBe(401);
    expect((await post(SVG, await session(), "https://example.invalid")).status).toBe(403);
  });

  test("an unknown id is 404; too large is 413; no source is 400", async () => {
    const me = await session();
    expect((await get("0".repeat(64), me)).status).toBe(404);
    expect((await post("x".repeat(2 * 1024 * 1024 + 1), me)).status).toBe(413);
    expect((await post(7, me)).status).toBe(400);
  });

  test("must-fail: a route that sets its own policy still serves the surface's; only the frame route gets the frame's", async () => {
    const mini = new Hono();
    mini.use("*", contentSecurityPolicy);
    const weak = { "Content-Security-Policy": "default-src *" };
    mini.get("/weak", (c) => c.text("x", 200, weak));
    mini.get("/api/page-frame/:id", (c) => c.text("x", 200, weak));
    mini.post("/api/page-frame/:id", (c) => c.text("x", 200, weak));
    const policy = async (path: string, method = "GET") => (await mini.request(path, { method })).headers.get("content-security-policy");
    expect(await policy("/weak")).toBe(CONTENT_SECURITY_POLICY);
    expect(await policy(`/api/page-frame/${"b".repeat(64)}`)).toBe(FRAME_POLICY);
    expect(await policy(`/api/page-frame/${"b".repeat(64)}`, "POST")).toBe(CONTENT_SECURITY_POLICY);
    expect(await policy("/api/page-frame/not-an-id")).toBe(CONTENT_SECURITY_POLICY);
  });

  test("must-fail: HEAD and GET on a frame carry the same policy", async () => {
    const mini = new Hono();
    mini.use("*", contentSecurityPolicy);
    mini.get("/api/page-frame/:id", (c) => c.text("x"));
    const path = `/api/page-frame/${"c".repeat(64)}`;
    const get = (await mini.request(path)).headers.get("content-security-policy");
    const head = (await mini.request(path, { method: "HEAD" })).headers.get("content-security-policy");
    expect(get).toBe(FRAME_POLICY);
    expect(head).toBe(get);
  });
});
