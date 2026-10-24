/**
 * A person signs in on the surface, and a verdict they give is written as
 * theirs: identity's session token stays on the server, an on-behalf-of token
 * is minted with this vessel's own key for the node the label writer checks,
 * and the write carries it as Bearer. Signed out, nothing changes.
 *
 * The contract is the one identity and activity-api ship (identity
 * src/index.ts /v1/auth/login and /v1/auth/on-behalf-of, src/services/obo.ts;
 * activity-api goal-verification-label-write.ts isPersonSessionPrincipal).
 */
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { restoreNativeGlobals, testAuth } from "./setup.ts";
await restoreNativeGlobals();
import { Hono } from "hono";
import { proxyRouter } from "../src/routes/proxy.ts";
import { recentObservations } from "../src/store.ts";
import { openSession, resetLabelProducerCache, resetPersonSessions } from "../src/person-session.ts";

const LOGIN_TOKEN = "eyJ.person-session-token.sig";
const OBO_TOKEN = "eyJ.on-behalf-of-token.sig";
const NODE = "node-a";

type Row = Record<string, unknown>;
let registry: Row[] = [];
let loginStatus = 200;
let labelStatus = 200;
const calls: { url: string; auth: string | null; body: Record<string, unknown> }[] = [];

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  const headers = new Headers(init?.headers);
  const body = (() => {
    try {
      return JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    } catch {
      return {};
    }
  })();
  calls.push({ url, auth: headers.get("Authorization"), body });
  if (url.endsWith("/v1/auth/login")) {
    if (loginStatus !== 200) return Response.json({ error: { code: "INVALID_CREDENTIALS" } }, { status: loginStatus });
    return Response.json({
      token: LOGIN_TOKEN,
      user: { id: "user:alex", email: "alex@example.test", name: "Alex", org_id: "org:one", role: "member" },
      user_id: "user:alex",
      org_id: "org:one",
      expires_at: new Date(Date.now() + 900_000).toISOString(),
    });
  }
  if (url.endsWith("/v1/auth/on-behalf-of")) {
    return Response.json({ success: true, data: { token: OBO_TOKEN, expires_at: new Date(Date.now() + 60_000).toISOString() } });
  }
  if (url.endsWith("/resolve") && body["type"] === "goalWalkOutput") {
    return Response.json({ resolved: true, shape: "goalWalkOutput", body: { dispatchId: body["dispatchId"], impulseId: body["impulseId"], contentType: "text", content: "the whole output", chars: 16, truncated: false } });
  }
  if (url.endsWith("/resolve") && body["type"] === "goalWalkState") {
    return Response.json({ resolved: true, shape: "goalWalkState", body: { dispatchId: body["dispatchId"], poolProvenance: [] } });
  }
  if (url.endsWith("/resolve") && (body["pointer"] as Row | undefined)?.["type"] === "vesselRegistry") {
    return Response.json({ content: { vessels: registry, totalCount: registry.length } });
  }
  if (url.endsWith("/v2/impulses/resolve") && String(init?.body ?? "").includes("goal_verification_label_write")) {
    return Response.json(labelStatus === 200 ? { success: true } : { success: false, error: 'labeler "human" requires a person session' }, { status: labelStatus });
  }
  return new Response("{}", { status: 404 });
}) as typeof fetch;
afterAll(() => {
  globalThis.fetch = realFetch;
});

const LOCAL_ROW: Row = { vesselId: "activity-api", shapes: ["goal_verification_label_write"], endpoint: "http://writer.local:8080", protocol: "http", origin: "local", metadata: { node: NODE } };
const OVERLAY_ROW: Row = { vesselId: "activity-api@remote", shapes: ["goal_verification_label_write"], endpoint: "http://remote.overlay:8080", protocol: "libp2p", origin: "overlay", metadata: { node: "node-b" } };

const app = new Hono();
app.route("/", proxyRouter);
const ORIGIN = "http://127.0.0.1:8310";
const at = (path: string) => `${ORIGIN}${path}`;
const post = (path: string, body: unknown, cookie?: string) =>
  app.request(at(path), { method: "POST", headers: { "content-type": "application/json", Origin: ORIGIN, ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
const get = (path: string, cookie?: string) => app.request(at(path), { headers: { Origin: ORIGIN, ...(cookie ? { Cookie: cookie } : {}) } });

async function signIn(): Promise<{ res: Response; cookie: string }> {
  const res = await post("/api/session/login", { email: "alex@example.test", password: "correct horse" });
  const set = res.headers.get("Set-Cookie") ?? "";
  return { res, cookie: set.split(";")[0] ?? "" };
}

const grade = (dispatchId: string, cookie?: string) =>
  post("/api/grade", { execution_id: `e-${dispatchId}`, dispatch_id: dispatchId, goal: "Where is it raining?", verdict: "not_achieved", notes: "wrong answer", judge_reached: true }, cookie);

async function kept(dispatchId: string): Promise<Row[]> {
  const r = await get(`/api/verdicts?dispatch_id=${dispatchId}`);
  return ((await r.json()) as { body: { verdicts: Row[] } }).body.verdicts;
}

beforeEach(() => {
  resetPersonSessions();
  resetLabelProducerCache();
  registry = [LOCAL_ROW];
  loginStatus = 200;
  labelStatus = 200;
  calls.length = 0;
});

describe("a person signed in on the surface", () => {
  test("sign-in is offered only where this node serves the label write itself", async () => {
    expect(await (await get("/api/session")).json()).toMatchObject({ available: true, signedIn: false });
    resetLabelProducerCache();
    registry = [OVERLAY_ROW];
    expect(await (await get("/api/session")).json()).toMatchObject({ available: false, signedIn: false });
    resetLabelProducerCache();
    registry = [{ ...LOCAL_ROW, metadata: {} }];
    expect(((await (await get("/api/session")).json()) as Row)["available"]).toBe(false);
  });

  test("must-fail: signing in keeps the token on the server; the browser gets an HttpOnly cookie and a name", async () => {
    const { res, cookie } = await signIn();
    expect(res.status).toBe(200);
    const set = res.headers.get("Set-Cookie") ?? "";
    expect(set).toMatch(/^sf_person=[0-9a-f]{64}; HttpOnly; SameSite=Strict; Path=\/; Max-Age=(89\d|900)$/);
    const text = await res.text();
    expect(text).not.toContain(LOGIN_TOKEN);
    expect(JSON.parse(text)).toMatchObject({ signedIn: true, person: { userId: "user:alex", name: "Alex" } });
    expect(calls.find((c) => c.url.endsWith("/v1/auth/login"))?.body).toEqual({ email: "alex@example.test", password: "correct horse" });
    const state = await (await get("/api/session", cookie)).text();
    expect(state).not.toContain(LOGIN_TOKEN);
    expect(JSON.parse(state)).toMatchObject({ signedIn: true, person: { name: "Alex" } });
  });

  test("must-fail: a signed-in verdict is written as the person, with a token minted for the writer's node", async () => {
    const { cookie } = await signIn();
    calls.length = 0;
    const r = await grade("d-person", cookie);
    expect(r.status).toBe(200);
    const mint = calls.find((c) => c.url.endsWith("/v1/auth/on-behalf-of"));
    expect(mint?.auth).toBe(`ApiKey ${process.env.METABOB_API_KEY}`);
    expect(mint?.body).toMatchObject({ caller: `Bearer ${LOGIN_TOKEN}`, audience: { node: NODE, shape: "goal_verification_label_write" } });
    const write = calls.find((c) => c.url.endsWith("/v2/impulses/resolve"));
    expect(write?.url).toBe("http://writer.local:8080/v2/impulses/resolve");
    expect(write?.auth).toBe(`Bearer ${OBO_TOKEN}`);
    expect(((write?.body["impulse"] as Row)["pointer"] as Row)["labeler"]).toBe("human");
    const [v] = await kept("d-person");
    expect(v?.["by"]).toEqual({ user_id: "user:alex", name: "Alex" });
    expect(v?.["delivery"]).toMatchObject({ recorded: true });
  });

  test("signed out, a verdict goes as before: this vessel's key, to activity-api, kept either way", async () => {
    labelStatus = 403;
    const r = await grade("d-anon");
    expect(r.status).toBe(403);
    expect(calls.some((c) => c.url.endsWith("/v1/auth/on-behalf-of"))).toBe(false);
    const write = calls.find((c) => c.url.endsWith("/v2/impulses/resolve"));
    expect(write?.auth).toBe(`ApiKey ${process.env.METABOB_API_KEY}`);
    const [v] = await kept("d-anon");
    expect(v?.["by"]).toBeNull();
    expect(v?.["delivery"]).toMatchObject({ recorded: false, status: 403 });
  });

  test("where the writer is only reachable over the overlay, a signed-in verdict is kept and not sent", async () => {
    const { cookie } = await signIn();
    resetLabelProducerCache();
    registry = [OVERLAY_ROW];
    calls.length = 0;
    const r = await grade("d-relay", cookie);
    expect(r.status).toBe(503);
    expect(calls.some((c) => c.url.endsWith("/v1/auth/on-behalf-of") || c.url.endsWith("/v2/impulses/resolve"))).toBe(false);
    const [v] = await kept("d-relay");
    expect(v?.["delivery"]).toMatchObject({ recorded: false, reason: "sign-in isn't available on this node" });
  });

  test("must-fail: over TLS the session cookie is Secure, directly or behind a TLS proxy; over plain http it is not", async () => {
    const tls = await app.request("https://127.0.0.1:8310/api/session/login", { method: "POST", headers: { "content-type": "application/json", Origin: "https://127.0.0.1:8310" }, body: JSON.stringify({ email: "alex@example.test", password: "correct horse" }) });
    expect(tls.headers.get("Set-Cookie")).toMatch(/; Secure$/);
    // X-Forwarded-Proto is believed from the local proxy (a loopback peer) and from nobody else.
    const fromPeer = (address: string) => ({ requestIP: () => ({ address }) });
    const login = { method: "POST", headers: { "content-type": "application/json", Origin: ORIGIN, "X-Forwarded-Proto": "https" }, body: JSON.stringify({ email: "alex@example.test", password: "correct horse" }) };
    expect((await app.request(at("/api/session/login"), login, fromPeer("127.0.0.1"))).headers.get("Set-Cookie")).toMatch(/; Secure$/);
    expect((await app.request(at("/api/session/login"), login, fromPeer("::1"))).headers.get("Set-Cookie")).toMatch(/; Secure$/);
    expect((await app.request(at("/api/session/login"), login, fromPeer("203.0.113.9"))).headers.get("Set-Cookie")).not.toContain("Secure");
    expect((await app.request(at("/api/session/login"), login)).headers.get("Set-Cookie")).not.toContain("Secure");
    const plain = await signIn();
    expect(plain.res.headers.get("Set-Cookie")).not.toContain("Secure");
    const out = await app.request(at("/api/session/logout"), { method: "POST", headers: { Origin: ORIGIN, "X-Forwarded-Proto": "https", Cookie: plain.cookie } }, fromPeer("127.0.0.1"));
    expect(out.headers.get("Set-Cookie")).toBe("sf_person=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0; Secure");
  });

  test("must-fail: sign-in is refused unless it comes from this surface's page, keyed or not", async () => {
    const cross = await app.request(at("/api/session/login"), { method: "POST", headers: { "content-type": "application/json", Origin: "http://evil.example" }, body: JSON.stringify({ email: "alex@example.test", password: "correct horse" }) });
    expect(cross.status).not.toBe(200);
    expect(cross.headers.get("Set-Cookie")).toBeNull();
    const keyedNoOrigin = await app.request(at("/api/session/login"), { method: "POST", headers: { "content-type": "application/json", ...testAuth() }, body: JSON.stringify({ email: "alex@example.test", password: "correct horse" }) });
    expect(keyedNoOrigin.status).toBe(403);
    expect(keyedNoOrigin.headers.get("Set-Cookie")).toBeNull();
    expect(calls.some((c) => c.url.endsWith("/v1/auth/login"))).toBe(false);
    const { cookie } = await signIn();
    const keyedLogout = await app.request(at("/api/session/logout"), { method: "POST", headers: { ...testAuth(), Cookie: cookie } });
    expect(keyedLogout.status).toBe(403);
    expect(await (await get("/api/session", cookie)).json()).toMatchObject({ signedIn: true });
  });

  test("must-fail: a run's whole output is read only for a signed-in person; the preview read is unchanged", async () => {
    const path = "/api/walk-output?dispatch_id=d-1&impulse_id=imp-1";
    const none = await get(path);
    expect(none.status).toBe(401);
    expect(((await none.json()) as Row)["error"]).toBe("sign in to read full outputs");
    expect(calls.some((c) => c.body["type"] === "goalWalkOutput")).toBe(false);
    const { cookie } = await signIn();
    const read = await get(path, cookie);
    expect(read.status).toBe(200);
    expect(((await read.json()) as { body: Row }).body["content"]).toBe("the whole output");
    expect(calls.find((c) => c.body["type"] === "goalWalkOutput")?.body).toEqual({ type: "goalWalkOutput", dispatchId: "d-1", impulseId: "imp-1" });
    const { cookie: stale } = openSession({ token: "t", userId: "user:old", orgId: null, email: null, name: null, expiresAt: Date.now() - 1 });
    expect((await get(path, stale.split(";")[0])).status).toBe(401);
    // Control: the run's state (with its previews) still reads keyless from the page, signed in or not,
    // and the whole output is not reachable through the general resolve route.
    expect((await post("/api/resolve", { type: "goalWalkState", dispatchId: "d-1" })).status).toBe(200);
    expect((await post("/api/resolve", { type: "goalWalkOutput", dispatchId: "d-1", impulseId: "imp-1" }, cookie)).status).toBe(403);
  });

  test("a wrong password sets no cookie, and repeated failures are refused for a while", async () => {
    loginStatus = 401;
    for (let i = 0; i < 5; i++) {
      const r = await post("/api/session/login", { email: "alex@example.test", password: "wrong" });
      expect(r.status).toBe(401);
      expect(r.headers.get("Set-Cookie")).toBeNull();
    }
    expect((await post("/api/session/login", { email: "alex@example.test", password: "wrong" })).status).toBe(429);
  });

  test("an expired session reads as signed out; signing out ends it", async () => {
    const { cookie: stale } = openSession({ token: "t", userId: "user:old", orgId: null, email: null, name: "Old", expiresAt: Date.now() - 1 });
    expect(await (await get("/api/session", stale.split(";")[0])).json()).toMatchObject({ signedIn: false });
    const { cookie } = await signIn();
    const out = await post("/api/session/logout", {}, cookie);
    expect(out.headers.get("Set-Cookie")).toBe("sf_person=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0");
    expect(await (await get("/api/session", cookie)).json()).toMatchObject({ signedIn: false });
  });

  test("must-fail: no credential is kept in what the surface records", async () => {
    const { cookie } = await signIn();
    await grade("d-scan", cookie);
    await post("/api/session/logout", {}, cookie);
    const all = JSON.stringify(recentObservations(500));
    for (const secret of [LOGIN_TOKEN, OBO_TOKEN, "correct horse"]) expect(all).not.toContain(secret);
    expect(JSON.stringify(await kept("d-scan"))).not.toContain(LOGIN_TOKEN);
  });
});
