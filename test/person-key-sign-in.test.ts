/**
 * A person signs in with their own key, and a row they write through the page's discovery
 * path is sent under that key, so records names them as its writer. The node's own key is
 * never a person's: it is refused at sign-in, and no write from the page is sent under it.
 * Reads still go under the node's key. Signed out, a write is refused and nothing is sent.
 * Whether sign-in is offered depends on identity alone.
 *
 * The verdict row is the form the walk's fold counts: {shape:"outcome", r, input_refs:[answer id]}.
 */
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { restoreNativeGlobals } from "./setup.ts";
await restoreNativeGlobals();
import { Hono } from "hono";
import { proxyRouter } from "../src/routes/proxy.ts";
import { resetPersonSessions } from "../src/person-session.ts";
import { __resetCredentialCacheForTests } from "../src/caller-credential.ts";
import { recentObservations } from "../src/store.ts";

const PERSON_KEY = "person-key-abc123";
const NODE_KEY = process.env.METABOB_API_KEY!;
const OUTCOME = { type: "record_write", row: { shape: "outcome", r: 1, input_refs: ["01ca30b1"] } };

let identityKnows = true;
const calls: { url: string; auth: string | null; body: Record<string, unknown> }[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
  calls.push({ url, auth: new Headers(init?.headers).get("Authorization"), body });
  if (url.endsWith("/v1/auth/resolve")) {
    const key = ((body["impulse"] as Record<string, unknown>)["pointer"] as Record<string, unknown>)["apiKey"];
    return Response.json({ success: true, data: identityKnows && key === PERSON_KEY ? { authenticated: true, scopes: ["read", "write"], keyId: "key_person_1" } : { authenticated: false } });
  }
  if (url.endsWith("/resolve")) return Response.json({ ok: true, seq: 200 });
  return new Response("{}", { status: 404 });
}) as typeof fetch;
afterAll(() => {
  globalThis.fetch = realFetch;
});

const app = new Hono();
app.route("/", proxyRouter);
const ORIGIN = "http://127.0.0.1:8310";
const post = (path: string, body: unknown, cookie?: string) =>
  app.request(`${ORIGIN}${path}`, { method: "POST", headers: { "content-type": "application/json", Origin: ORIGIN, ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
const cookieOf = (res: Response) => (res.headers.get("Set-Cookie") ?? "").split(";")[0] ?? "";
const toDiscovery = () => calls.filter((c) => c.url.endsWith("/resolve") && !c.url.endsWith("/v1/auth/resolve"));

beforeEach(() => {
  resetPersonSessions();
  __resetCredentialCacheForTests();
  identityKnows = true;
  calls.length = 0;
});

describe("signing in with a person's own key", () => {
  test("must-fail: sign-in is offered where identity is configured, and asks no other vessel whether to offer it", async () => {
    const state = await (await app.request(`${ORIGIN}/api/session`, { headers: { Origin: ORIGIN } })).json();
    expect(state).toEqual({ keySignIn: true, signedIn: false });
    expect(calls).toEqual([]);
  });

  test("must-fail: identity checks the key; the browser gets a cookie and the key id, never the key", async () => {
    const res = await post("/api/session/key", { key: PERSON_KEY });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(PERSON_KEY);
    expect(JSON.parse(text)).toMatchObject({ signedIn: true, person: { userId: "key_person_1" } });
    expect(res.headers.get("Set-Cookie")).toMatch(/^sf_person=[0-9a-f]{64}; HttpOnly; SameSite=Strict; Path=\/; Max-Age=(89\d|900)$/);
    const state = await (await app.request(`${ORIGIN}/api/session`, { headers: { Origin: ORIGIN, Cookie: cookieOf(res) } })).json();
    expect(state).toMatchObject({ keySignIn: true, signedIn: true });
  });

  test("must-fail: the node's own key is refused as a person's", async () => {
    const res = await post("/api/session/key", { key: NODE_KEY });
    expect(res.status).toBe(403);
    expect(res.headers.get("Set-Cookie")).toBeNull();
  });

  test("a key identity does not know signs nobody in", async () => {
    identityKnows = false;
    const res = await post("/api/session/key", { key: PERSON_KEY });
    expect(res.status).toBe(401);
    expect(res.headers.get("Set-Cookie")).toBeNull();
  });

  test("must-fail: sign-in with a key is refused unless it comes from this surface's page", async () => {
    const res = await app.request(`${ORIGIN}/api/session/key`, { method: "POST", headers: { "content-type": "application/json", Origin: "http://elsewhere.test" }, body: JSON.stringify({ key: PERSON_KEY }) });
    expect([401, 403]).toContain(res.status);
    expect(res.headers.get("Set-Cookie")).toBeNull();
    expect(calls).toEqual([]);
  });
});

describe("the page's discovery path: reads under the node's key, writes under the person's", () => {
  test("must-fail: signed out, a write is refused and nothing is sent", async () => {
    const res = await post("/api/discovery/resolve", { pointer: OUTCOME });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: "sign_in_required" });
    expect(toDiscovery()).toEqual([]);
  });

  test("must-fail: a refused write keeps what the person tried to say", async () => {
    await post("/api/discovery/resolve", { pointer: OUTCOME });
    const kept = recentObservations(5).find((o) => o.type === "person_write");
    expect(kept?.body).toEqual({ recorded: false, reason: "sign_in_required", pointer: OUTCOME });
    expect(toDiscovery()).toEqual([]);
  });

  test("must-fail: signed in with a key, the verdict row is sent under that key and never the node's", async () => {
    const cookie = cookieOf(await post("/api/session/key", { key: PERSON_KEY }));
    calls.length = 0;
    const res = await post("/api/discovery/resolve", { pointer: OUTCOME }, cookie);
    expect(res.status).toBe(200);
    const sent = toDiscovery();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.auth).toBe(`ApiKey ${PERSON_KEY}`);
    expect(sent[0]!.body).toEqual({ pointer: OUTCOME });
  });

  test("must-fail: a mutating primitive not named `_write` is a write too: refused signed out, never under the node's key", async () => {
    const commit = { type: "git_commit", message: "x" };
    expect((await post("/api/discovery/resolve", { pointer: commit })).status).toBe(401);
    expect(toDiscovery()).toEqual([]);
    const cookie = cookieOf(await post("/api/session/key", { key: PERSON_KEY }));
    calls.length = 0;
    await post("/api/discovery/resolve", { pointer: commit }, cookie);
    expect(toDiscovery().map((c) => c.auth)).toEqual([`ApiKey ${PERSON_KEY}`]);
  });

  test("a read goes under the node's key, signed in or not", async () => {
    const cookie = cookieOf(await post("/api/session/key", { key: PERSON_KEY }));
    calls.length = 0;
    await post("/api/discovery/resolve", { pointer: { type: "record_read", shape: "answer" } }, cookie);
    await post("/api/discovery/resolve", { pointer: { type: "record_read", shape: "answer" } });
    expect(toDiscovery().map((c) => c.auth)).toEqual([`ApiKey ${NODE_KEY}`, `ApiKey ${NODE_KEY}`]);
  });
});
