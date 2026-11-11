/**
 * A person's session on the surface: the browser holds only an HttpOnly cookie naming it, the
 * cookie is Secure whenever the page arrived over TLS, signing in and out are the page's own
 * acts, repeated failures are refused for a while, an expired session reads as signed out, and
 * no credential is kept in what the surface records. Signing in is with the person's own key
 * (test/person-key-sign-in.test.ts holds what identity checks).
 */
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { restoreNativeGlobals, testAuth } from "./setup.ts";
await restoreNativeGlobals();
import { Hono } from "hono";
import { proxyRouter } from "../src/routes/proxy.ts";
import { recentObservations } from "../src/store.ts";
import { openSession, resetPersonSessions } from "../src/person-session.ts";
import { __resetCredentialCacheForTests } from "../src/caller-credential.ts";

const PERSON_KEY = "person-key-xyz789";

type Row = Record<string, unknown>;
const calls: { url: string; body: Row }[] = [];

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  const body = (() => {
    try {
      return JSON.parse(String(init?.body ?? "{}")) as Row;
    } catch {
      return {};
    }
  })();
  calls.push({ url, body });
  if (url.endsWith("/v1/auth/resolve")) {
    const key = ((body["impulse"] as Row)["pointer"] as Row)["apiKey"];
    return Response.json({ success: true, data: key === PERSON_KEY ? { authenticated: true, scopes: ["read", "write"], keyId: "key_alex" } : { authenticated: false } });
  }
  if (url.endsWith("/resolve")) return Response.json({ ok: true, seq: 1 });
  return new Response("{}", { status: 404 });
}) as typeof fetch;
afterAll(() => {
  globalThis.fetch = realFetch;
});

const app = new Hono();
app.route("/", proxyRouter);
const ORIGIN = "http://127.0.0.1:8310";
const at = (path: string) => `${ORIGIN}${path}`;
const post = (path: string, body: unknown, cookie?: string) =>
  app.request(at(path), { method: "POST", headers: { "content-type": "application/json", Origin: ORIGIN, ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
const get = (path: string, cookie?: string) => app.request(at(path), { headers: { Origin: ORIGIN, ...(cookie ? { Cookie: cookie } : {}) } });

async function signIn(): Promise<{ res: Response; cookie: string }> {
  const res = await post("/api/session/key", { key: PERSON_KEY });
  const set = res.headers.get("Set-Cookie") ?? "";
  return { res, cookie: set.split(";")[0] ?? "" };
}

beforeEach(() => {
  resetPersonSessions();
  __resetCredentialCacheForTests();
  calls.length = 0;
});

describe("a person signed in on the surface", () => {
  test("must-fail: over TLS the session cookie is Secure, directly or behind a TLS proxy; over plain http it is not", async () => {
    const tls = await app.request("https://127.0.0.1:8310/api/session/key", { method: "POST", headers: { "content-type": "application/json", Origin: "https://127.0.0.1:8310" }, body: JSON.stringify({ key: PERSON_KEY }) });
    expect(tls.headers.get("Set-Cookie")).toMatch(/; Secure$/);
    // X-Forwarded-Proto is believed from the local proxy (a loopback peer) and from nobody else.
    const fromPeer = (address: string) => ({ requestIP: () => ({ address }) });
    const login = { method: "POST", headers: { "content-type": "application/json", Origin: ORIGIN, "X-Forwarded-Proto": "https" }, body: JSON.stringify({ key: PERSON_KEY }) };
    expect((await app.request(at("/api/session/key"), login, fromPeer("127.0.0.1"))).headers.get("Set-Cookie")).toMatch(/; Secure$/);
    expect((await app.request(at("/api/session/key"), login, fromPeer("::1"))).headers.get("Set-Cookie")).toMatch(/; Secure$/);
    expect((await app.request(at("/api/session/key"), login, fromPeer("203.0.113.9"))).headers.get("Set-Cookie")).not.toContain("Secure");
    expect((await app.request(at("/api/session/key"), login)).headers.get("Set-Cookie")).not.toContain("Secure");
    const plain = await signIn();
    expect(plain.res.headers.get("Set-Cookie")).not.toContain("Secure");
    const out = await app.request(at("/api/session/logout"), { method: "POST", headers: { Origin: ORIGIN, "X-Forwarded-Proto": "https", Cookie: plain.cookie } }, fromPeer("127.0.0.1"));
    expect(out.headers.get("Set-Cookie")).toBe("sf_person=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0; Secure");
  });

  test("must-fail: signing in and out are refused unless they come from this surface's page, keyed or not", async () => {
    const keyedNoOrigin = await app.request(at("/api/session/key"), { method: "POST", headers: { "content-type": "application/json", ...testAuth() }, body: JSON.stringify({ key: PERSON_KEY }) });
    expect(keyedNoOrigin.status).toBe(403);
    expect(keyedNoOrigin.headers.get("Set-Cookie")).toBeNull();
    const { cookie } = await signIn();
    const keyedLogout = await app.request(at("/api/session/logout"), { method: "POST", headers: { ...testAuth(), Cookie: cookie } });
    expect(keyedLogout.status).toBe(403);
    expect(await (await get("/api/session", cookie)).json()).toMatchObject({ signedIn: true });
  });

  test("must-fail: a page drawn while signed in loads only under that person's session", async () => {
    const frame = `sf_frame=${"ab".repeat(16)}`;
    const { cookie: alex } = await signIn();
    const posted = await app.request(at("/api/page-frame"), { method: "POST", headers: { "content-type": "application/json", Origin: ORIGIN, Cookie: `${frame}; ${alex}` }, body: JSON.stringify({ source: "<p>hello</p>" }) });
    expect(posted.status).toBe(200);
    const { id } = (await posted.json()) as { id: string };
    const load = (cookie: string) => app.request(at(`/api/page-frame/${id}`), { headers: { Cookie: cookie } });
    expect((await load(`${frame}; ${alex}`)).status).toBe(200);
    // Signed out, or someone else signed in, in the same browser: not theirs to load.
    expect((await load(frame)).status).toBe(404);
    const { cookie: other } = openSession({ apiKey: "k2", userId: "user:sam", orgId: null, email: null, name: "Sam", expiresAt: Date.now() + 60_000 });
    expect((await load(`${frame}; ${other.split(";")[0]}`)).status).toBe(404);
    // A page drawn signed out stays the browser's, as before.
    const anon = await app.request(at("/api/page-frame"), { method: "POST", headers: { "content-type": "application/json", Origin: ORIGIN, Cookie: frame }, body: JSON.stringify({ source: "<p>hi</p>" }) });
    const anonId = ((await anon.json()) as { id: string }).id;
    expect((await app.request(at(`/api/page-frame/${anonId}`), { headers: { Cookie: frame } })).status).toBe(200);
  });

  test("a key identity does not know sets no cookie, and repeated failures are refused for a while", async () => {
    for (let i = 0; i < 5; i++) {
      const r = await post("/api/session/key", { key: "not-a-key" });
      expect(r.status).toBe(401);
      expect(r.headers.get("Set-Cookie")).toBeNull();
    }
    expect((await post("/api/session/key", { key: "not-a-key" })).status).toBe(429);
  });

  test("an expired session reads as signed out; signing out ends it", async () => {
    const { cookie: stale } = openSession({ apiKey: "k", userId: "user:old", orgId: null, email: null, name: "Old", expiresAt: Date.now() - 1 });
    expect(await (await get("/api/session", stale.split(";")[0])).json()).toMatchObject({ signedIn: false });
    const { cookie } = await signIn();
    const out = await post("/api/session/logout", {}, cookie);
    expect(out.headers.get("Set-Cookie")).toBe("sf_person=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0");
    expect(await (await get("/api/session", cookie)).json()).toMatchObject({ signedIn: false });
  });

  test("must-fail: no credential is kept in what the surface records", async () => {
    const { cookie } = await signIn();
    await post("/api/discovery/resolve", { pointer: { type: "record_write", row: { shape: "outcome", r: 0, input_refs: ["a1"] } } }, cookie);
    await post("/api/session/logout", {}, cookie);
    await post("/api/discovery/resolve", { pointer: { type: "record_write", row: { shape: "outcome", r: 0, input_refs: ["a1"] } } }, cookie);
    expect(JSON.stringify(recentObservations(500))).not.toContain(PERSON_KEY);
  });
});
