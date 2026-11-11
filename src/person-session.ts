/**
 * A person signed in on this surface with their own key, so a row they write (an ask, a
 * verdict) is recorded as theirs: records stamps the writer from the key a write arrives
 * under, and discovery `/resolve` admits only keys.
 *
 * Identity alone decides whether a key is a person's: it must authenticate, and it must not be
 * this node's own key. Whether sign-in is offered depends on identity alone.
 *
 * WHAT NEVER LEAVES THE SERVER: the key. The browser holds only a random id in an HttpOnly,
 * SameSite=Strict cookie; the key stays in this process's memory, and a restart signs
 * everyone out (the page says so when a write is refused for it).
 *
 * Email and password sign-in is gone with the label write it served: identity's session token
 * cannot write a row through discovery (a gap discovery owns). It returns when a person's
 * token is admitted there.
 */

import { randomBytes } from "node:crypto";
import { identityCredential, isNodeSelfCredential } from "./caller-credential.ts";
import { IDENTITY_VESSEL_URL } from "./config.ts";

export const PERSON_COOKIE = "sf_person";
/** Sessions held at once. A surface has a handful of people; the cap only bounds memory. */
const MAX_SESSIONS = 64;
/** Failed sign-ins tolerated per window before refusing for the rest of it (identity limits too). */
const LOGIN_FAILURES_PER_WINDOW = 5;
const LOGIN_WINDOW_MS = 60_000;
/**
 * How long a sign-in with a person's own key lasts before they sign in again. A key does not
 * expire on its own; this matches identity's session (900 s) so both ways of signing in end
 * alike. A behaviour constant, named as debt: it belongs in a shape the surface reads.
 */
const KEY_SESSION_MS = 900_000;

export interface PersonSession {
  /**
   * The person's own API key, for a sign-in with a key. A person's rows (a verdict, an ask)
   * are written through discovery under it, so records names the person as their writer.
   * Held in this process's memory only; never sent to the browser.
   */
  readonly apiKey: string;
  readonly userId: string;
  readonly orgId: string | null;
  readonly email: string | null;
  readonly name: string | null;
  readonly expiresAt: number;
}

/** What the browser may see of a session. Never the key. */
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

/**
 * Whether the request reached this surface over TLS: directly (https), or through
 * the local TLS proxy, which says so in X-Forwarded-Proto. That header is believed
 * only from a loopback peer: any client can send it. The session cookie is then
 * marked Secure, so its id never travels in clear.
 */
export function arrivedOverTls(requestUrl: string, forwardedProto: string | undefined, peer: string): boolean {
  try {
    if (new URL(requestUrl).protocol === "https:") return true;
  } catch {
    /* not a URL: not TLS */
  }
  return isLoopback(peer) && (forwardedProto ?? "").split(",")[0]?.trim().toLowerCase() === "https";
}

function isLoopback(address: string): boolean {
  const a = address.trim().toLowerCase();
  return a === "::1" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(a) || /^::ffff:127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(a);
}

/** Hold a session; the cookie value and its Set-Cookie header. */
export function openSession(s: PersonSession, now = Date.now(), secure = false): { id: string; cookie: string } {
  for (const [id, held] of sessions) if (held.expiresAt <= now) sessions.delete(id);
  while (sessions.size >= MAX_SESSIONS) {
    const oldest = sessions.keys().next().value;
    if (oldest === undefined) break;
    sessions.delete(oldest);
  }
  const id = randomBytes(32).toString("hex");
  sessions.set(id, s);
  const maxAge = Math.max(0, Math.floor((s.expiresAt - now) / 1000));
  return { id, cookie: `${PERSON_COOKIE}=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure ? "; Secure" : ""}` };
}

/** End the session named by the cookie, if any; the Set-Cookie header that clears it. */
export function closeSession(cookieHeader: string | undefined, secure = false): string {
  const id = personCookieId(cookieHeader);
  if (id) sessions.delete(id);
  return `${PERSON_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure ? "; Secure" : ""}`;
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

/**
 * Sign a person in with their own API key: identity must authenticate it, and it must not be
 * this node's own key, which would let anyone at the page write as a person under the node's
 * credential. Who they are is the key id identity gives; the key itself is kept only here.
 */
export async function signInWithKey(apiKey: string, now = Date.now()): Promise<LoginResult> {
  if (!IDENTITY_VESSEL_URL) return { ok: false, status: 503, error: "sign-in is not available on this node" };
  const cred = await identityCredential(`ApiKey ${apiKey}`, { cache: false });
  if (isNodeSelfCredential(cred)) return { ok: false, status: 403, error: "this is the node's own key, not a person's" };
  if (!cred.authenticated) {
    const unreachable = (cred.why ?? "").startsWith("identity unreachable") || (cred.why ?? "").startsWith("IDENTITY_VESSEL_URL");
    return unreachable ? { ok: false, status: 502, error: "identity did not answer" } : { ok: false, status: 401, error: "identity does not know this key" };
  }
  const keyId = cred.keyId ?? null;
  if (!keyId) return { ok: false, status: 502, error: "identity did not say whose key this is" };
  return { ok: true, session: { apiKey, userId: keyId, orgId: null, email: null, name: null, expiresAt: now + KEY_SESSION_MS } };
}

/** Whether a person can sign in here with their own key: identity alone decides that. */
export function keySignInAvailable(): boolean {
  return IDENTITY_VESSEL_URL.length > 0;
}
