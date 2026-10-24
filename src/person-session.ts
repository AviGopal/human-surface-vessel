/**
 * A person signed in on this surface, so a verdict they give is recorded as
 * theirs (user ruling 10-17: a verdict needs a person's own credential; 10-19:
 * sign in on the surface).
 *
 * THE CONTRACT, as identity and activity-api ship it:
 *   1. identity POST /v1/auth/login {email, password} → a person's session
 *      token, valid 900 s, with no refresh: the person signs in again after it.
 *   2. identity POST /v1/auth/on-behalf-of, the actor presenting THIS vessel's
 *      own ApiKey, {caller: "Bearer <session token>", audience: {node, shape}}
 *      → a token for that one node and shape, valid at most 120 s.
 *   3. activity-api writes goal_verification_label_write with that token as
 *      Bearer, and stamps the label as a person's human verdict only when the
 *      token's node is its own (thisNode()). The node is read from the vessel
 *      registry row of the producer the write goes to, so the two cannot differ.
 *
 * WHAT NEVER LEAVES THE SERVER: the session token. The browser holds only a
 * random id in an HttpOnly, SameSite=Strict cookie; the token stays in this
 * process's memory, and a restart signs everyone out (at worst 15 minutes lost).
 * The password goes to identity once and is not kept anywhere. The on-behalf-of
 * token is minted right before each write and dropped after it.
 *
 * WHERE IT IS OFFERED: where this node serves the label write itself (a
 * registry row for the shape with a local origin). Where the write resolves on
 * another node over the relay, the path is built the same way but is not
 * offered until an end-to-end run through the relay has passed.
 */

import { randomBytes } from "node:crypto";
import { DISCOVERY_ENDPOINT, IDENTITY_VESSEL_URL, METABOB_API_KEY } from "./config.ts";

export const PERSON_COOKIE = "sf_person";
export const LABEL_WRITE_SHAPE = "goal_verification_label_write";
/** Sessions held at once. A surface has a handful of people; the cap only bounds memory. */
const MAX_SESSIONS = 64;
/** Failed sign-ins tolerated per window before refusing for the rest of it (identity limits too). */
const LOGIN_FAILURES_PER_WINDOW = 5;
const LOGIN_WINDOW_MS = 60_000;
/** How long a registry answer about the label writer is trusted. */
const PRODUCER_TTL_MS = 60_000;

export interface PersonSession {
  readonly token: string;
  readonly userId: string;
  readonly orgId: string | null;
  readonly email: string | null;
  readonly name: string | null;
  readonly expiresAt: number;
}

/** What the browser may see of a session. Never the token. */
export interface PersonView {
  readonly userId: string;
  readonly name: string | null;
  readonly email: string | null;
  readonly expiresAt: number;
}

const sessions = new Map<string, PersonSession>();

export function viewOf(s: PersonSession): PersonView {
  return { userId: s.userId, name: s.name, email: s.email, expiresAt: s.expiresAt };
}

/** The session named by a request's Cookie header, or null (none, unknown, or expired). */
export function sessionOf(cookieHeader: string | undefined, now = Date.now()): PersonSession | null {
  const id = personCookieId(cookieHeader);
  if (!id) return null;
  const s = sessions.get(id);
  if (!s) return null;
  if (s.expiresAt <= now) {
    sessions.delete(id);
    return null;
  }
  return s;
}

export function personCookieId(cookieHeader: string | undefined): string | null {
  const m = new RegExp(`(?:^|;\\s*)${PERSON_COOKIE}=([0-9a-f]{64})(?:;|$)`).exec(cookieHeader ?? "");
  return m?.[1] ?? null;
}

/** Hold a session; the cookie value and its Set-Cookie header. */
export function openSession(s: PersonSession, now = Date.now()): { id: string; cookie: string } {
  for (const [id, held] of sessions) if (held.expiresAt <= now) sessions.delete(id);
  while (sessions.size >= MAX_SESSIONS) {
    const oldest = sessions.keys().next().value;
    if (oldest === undefined) break;
    sessions.delete(oldest);
  }
  const id = randomBytes(32).toString("hex");
  sessions.set(id, s);
  const maxAge = Math.max(0, Math.floor((s.expiresAt - now) / 1000));
  return { id, cookie: `${PERSON_COOKIE}=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}` };
}

/** End the session named by the cookie, if any; the Set-Cookie header that clears it. */
export function closeSession(cookieHeader: string | undefined): string {
  const id = personCookieId(cookieHeader);
  if (id) sessions.delete(id);
  return `${PERSON_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;
}

/* ─── sign-in attempts ─────────────────────────────────────────────────────── */

let failures: number[] = [];

/** Whether another attempt is allowed now. Failures are counted in a rolling window. */
export function loginAllowed(now = Date.now()): boolean {
  failures = failures.filter((t) => now - t < LOGIN_WINDOW_MS);
  return failures.length < LOGIN_FAILURES_PER_WINDOW;
}

export function noteLoginFailure(now = Date.now()): void {
  failures.push(now);
}

/** For tests: forget sessions and failures. */
export function resetPersonSessions(): void {
  sessions.clear();
  failures = [];
}

/* ─── identity ─────────────────────────────────────────────────────────────── */

export type LoginResult =
  | { readonly ok: true; readonly session: PersonSession }
  | { readonly ok: false; readonly status: number; readonly error: string };

/** Sign a person in at identity. The password is sent once and not kept. */
export async function loginAtIdentity(email: string, password: string): Promise<LoginResult> {
  if (!IDENTITY_VESSEL_URL) return { ok: false, status: 503, error: "sign-in is not available on this node" };
  let res: Response;
  try {
    res = await fetch(`${IDENTITY_VESSEL_URL.replace(/\/+$/, "")}/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return { ok: false, status: 502, error: "identity did not answer" };
  }
  const j = (await res.json().catch(() => null)) as null | Record<string, unknown>;
  if (res.status === 401) return { ok: false, status: 401, error: "wrong email or password" };
  if (!res.ok || !j || typeof j["token"] !== "string") {
    return { ok: false, status: res.status >= 400 && res.status < 500 ? res.status : 502, error: "sign-in failed" };
  }
  const user = (j["user"] ?? {}) as Record<string, unknown>;
  const userId = typeof user["id"] === "string" ? user["id"] : typeof j["user_id"] === "string" ? (j["user_id"] as string) : null;
  // An ISO time today; seconds since the epoch accepted too, so a format change cannot sign everyone in forever.
  const rawExpiry = j["expires_at"];
  const expiresAt = typeof rawExpiry === "number" ? rawExpiry * 1000 : Date.parse(String(rawExpiry ?? ""));
  if (!userId || !Number.isFinite(expiresAt)) return { ok: false, status: 502, error: "sign-in failed" };
  return {
    ok: true,
    session: {
      token: j["token"] as string,
      userId,
      orgId: typeof user["org_id"] === "string" ? user["org_id"] : typeof j["org_id"] === "string" ? (j["org_id"] as string) : null,
      email: typeof user["email"] === "string" ? user["email"] : null,
      name: typeof user["name"] === "string" ? user["name"] : null,
      expiresAt,
    },
  };
}

export type OboResult = { readonly ok: true; readonly token: string } | { readonly ok: false; readonly status: number; readonly error: string };

/** A token for one write of the label shape at `node`, on the person's behalf. */
export async function mintLabelToken(session: PersonSession, node: string): Promise<OboResult> {
  if (!IDENTITY_VESSEL_URL || !METABOB_API_KEY) return { ok: false, status: 503, error: "sign-in is not available on this node" };
  let res: Response;
  try {
    res = await fetch(`${IDENTITY_VESSEL_URL.replace(/\/+$/, "")}/v1/auth/on-behalf-of`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `ApiKey ${METABOB_API_KEY}` },
      body: JSON.stringify({ caller: `Bearer ${session.token}`, audience: { node, shape: LABEL_WRITE_SHAPE }, ttl_seconds: 60 }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return { ok: false, status: 502, error: "identity did not answer" };
  }
  const j = (await res.json().catch(() => null)) as null | { data?: { token?: unknown }; error?: unknown; message?: unknown };
  const token = j?.data?.token;
  if (res.ok && typeof token === "string") return { ok: true, token };
  const said = typeof j?.error === "object" && j?.error !== null ? (j.error as { message?: unknown }).message : (j?.error ?? j?.message);
  return { ok: false, status: res.status, error: typeof said === "string" ? said : "the on-behalf-of token was refused" };
}

/* ─── where the label write goes ───────────────────────────────────────────── */

export interface LabelProducer {
  /** Where to send the write: the producer's resolve URL. */
  readonly url: string;
  /** The node its writer checks a token against (its registration's metadata.node). */
  readonly node: string;
  /** Served on this node, not over the overlay. */
  readonly local: boolean;
}

let producerCache: { at: number; value: LabelProducer | null } | null = null;

/** For tests. */
export function resetLabelProducerCache(): void {
  producerCache = null;
}

/**
 * The producer of the label write, from the vessel registry: a local row first.
 * Null when discovery has no row for the shape, or no row names its node.
 */
export async function labelProducer(now = Date.now()): Promise<LabelProducer | null> {
  if (producerCache && now - producerCache.at < PRODUCER_TTL_MS) return producerCache.value;
  let value: LabelProducer | null = null;
  try {
    const res = await fetch(`${DISCOVERY_ENDPOINT.replace(/\/+$/, "")}/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(METABOB_API_KEY ? { Authorization: `ApiKey ${METABOB_API_KEY}` } : {}) },
      body: JSON.stringify({ pointer: { type: "vesselRegistry", filters: { shapes: [LABEL_WRITE_SHAPE] } } }),
      signal: AbortSignal.timeout(8_000),
    });
    const j = (await res.json().catch(() => null)) as null | Record<string, unknown>;
    const body = (j?.["content"] ?? j?.["body"] ?? j) as Record<string, unknown> | null;
    const rows = Array.isArray(body?.["vessels"]) ? (body!["vessels"] as Record<string, unknown>[]) : [];
    const usable = rows
      .map((v) => {
        const node = (v["metadata"] as Record<string, unknown> | undefined)?.["node"];
        const endpoint = v["endpoint"];
        if (typeof node !== "string" || !node || typeof endpoint !== "string" || !/^https?:\/\//.test(endpoint)) return null;
        const local = v["origin"] === "local" && v["protocol"] !== "libp2p";
        // The label write is served on activity-api's impulse-resolve route, whatever path a row advertises for goal shapes.
        return { url: `${endpoint.replace(/\/+$/, "")}/v2/impulses/resolve`, node, local };
      })
      .filter((x): x is LabelProducer => x !== null);
    value = usable.find((p) => p.local) ?? usable[0] ?? null;
  } catch {
    value = null;
  }
  producerCache = { at: now, value };
  return value;
}

/** Whether a person can sign in here: identity is configured and this node serves the label write itself. */
export async function signInAvailable(): Promise<{ available: boolean; producer: LabelProducer | null }> {
  if (!IDENTITY_VESSEL_URL || !METABOB_API_KEY) return { available: false, producer: null };
  const producer = await labelProducer();
  return { available: producer !== null && producer.local, producer };
}
