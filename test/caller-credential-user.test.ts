// The user identity's answer names (data.userId) is carried on the caller credential, and nothing decides by it:
// admission (admitCaller), node-self, the scopes a caller gets and a person's sign-in each answer the same whether identity
// names a user or not. Identity is a loopback stub answering by key prefix, with or without a userId.
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { restoreNativeGlobals } from "./setup.ts";
await restoreNativeGlobals();
import { Hono } from "hono";
import { __resetCredentialCacheForTests, identityCredential, isNodeSelfCredential } from "../src/caller-credential.ts";
import { admittedCaller, requireCaller } from "../src/inbound-auth.ts";
import { resetPersonSessions, signInWithKey } from "../src/person-session.ts";

const NODE_KEY = process.env.METABOB_API_KEY!;
// what identity says about the user: a name, a non-string, an empty string, or nothing
let userId: unknown = undefined;
const identity = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(req) {
    const body = (await req.json().catch(() => ({}))) as { impulse?: { pointer?: { apiKey?: string } } };
    const key = String(body.impulse?.pointer?.apiKey ?? "");
    const user = userId === undefined ? {} : { userId };
    if (key === NODE_KEY) return Response.json({ success: true, data: { authenticated: true, scopes: ["node"], keyId: "node-self", ...user } });
    if (key.startsWith("u-op-")) return Response.json({ success: true, data: { authenticated: true, scopes: ["read", "write", "operator:direct"], keyId: "op-key-1", ...user } });
    if (key.startsWith("u-svc-")) return Response.json({ success: true, data: { authenticated: true, scopes: ["read", "write"], keyId: "svc-key-1", ...user } });
    if (key.startsWith("u-nokeyid-")) return Response.json({ success: true, data: { authenticated: true, scopes: ["read"], ...user } });
    return Response.json({ success: false, error: "invalid" }, { status: 401 });
  },
});
const realUrl = process.env.IDENTITY_VESSEL_URL;
process.env.IDENTITY_VESSEL_URL = `http://127.0.0.1:${identity.port}`;
afterAll(() => {
  identity.stop(true);
  process.env.IDENTITY_VESSEL_URL = realUrl;
});

const app = new Hono();
app.post("/w", requireCaller("/w"), (c) => c.json({ caller: admittedCaller(c) }));

beforeEach(() => {
  __resetCredentialCacheForTests();
  resetPersonSessions();
  userId = undefined;
});

describe("the user identity names is carried", () => {
  test("[MUST-FAIL] a userId identity answers is on the credential; a non-string or empty one, or none, is not", async () => {
    userId = "user-42";
    expect((await identityCredential("ApiKey u-svc-1", { cache: false })).userId).toBe("user-42");
    for (const v of [7, "", undefined]) {
      __resetCredentialCacheForTests();
      userId = v;
      const cred = await identityCredential("ApiKey u-svc-1", { cache: false });
      expect([String(v), "userId" in cred]).toEqual([String(v), false]);
    }
  });
});

describe("no decision reads the user identity names (a guard: every gate answers the same with or without one)", () => {
  const KEYS = ["u-op-1", "u-svc-1", "u-nokeyid-1", NODE_KEY, "nobody-1"];
  const decisions = async () => {
    const out: unknown[] = [];
    for (const key of KEYS) {
      __resetCredentialCacheForTests();
      const { userId: _carried, ...cred } = await identityCredential(`ApiKey ${key}`, { cache: false });
      out.push({ key, cred, nodeSelf: isNodeSelfCredential({ ...cred, ...(_carried === undefined ? {} : { userId: _carried }) }) });
      __resetCredentialCacheForTests();
      const res = await app.request("http://127.0.0.1/w", { method: "POST", headers: { Authorization: `ApiKey ${key}` } });
      out.push({ key, status: res.status, admitted: res.status === 200 ? await res.json() : null });
      __resetCredentialCacheForTests();
      const signed = await signInWithKey(key, 1_000);
      out.push({ key, signed: signed.ok ? { ok: true, session: signed.session } : signed });
    }
    return out;
  };
  test("admission, node-self, scopes and sign-in are the same whether identity names a user or not", async () => {
    userId = undefined;
    const without = await decisions();
    userId = "user-42";
    const withUser = await decisions();
    expect(withUser).toEqual(without);
    expect(without.filter((d) => (d as { status?: number }).status === 200).map((d) => (d as { key: string }).key)).toEqual(["u-op-1", "u-svc-1", "u-nokeyid-1", NODE_KEY]);
  });
});
