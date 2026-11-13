/**
 * The frame session cookie the shell sets follows the same Secure rule as the sign-in cookie: with a stated https public
 * origin it is always Secure (the person reaches the surface over TLS whatever scheme the proxy used to reach this
 * process); with none, over plain http, it is as before.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { app } from "../src/index.ts";

const frameCookie = (res: Response): string => (res.headers.getSetCookie?.() ?? [res.headers.get("Set-Cookie") ?? ""]).find((c) => c.startsWith("sf_frame=")) ?? "";

describe("the frame session cookie", () => {
  afterEach(() => { delete process.env.HUMAN_SURFACE_PUBLIC_URL; });

  test("must-fail: with a stated https public origin, the shell's sf_frame cookie is Secure (behind the proxy's plain http)", async () => {
    process.env.HUMAN_SURFACE_PUBLIC_URL = "https://surface.example";
    const set = frameCookie(await app.request("http://surface.example/"));
    expect(set).toContain("sf_frame=");
    expect(set).toMatch(/; Secure$/);
    expect(set).toContain("HttpOnly; SameSite=Strict");
  });

  test("control: with none stated, over plain http, it is not Secure, as before", async () => {
    const set = frameCookie(await app.request("http://127.0.0.1/"));
    expect(set).toContain("sf_frame=");
    expect(set).not.toContain("Secure");
  });
});
