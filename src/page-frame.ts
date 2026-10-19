/**
 * Markup drawn as a page, served from its own URL with its own policy (the
 * user-approved follow-up to the surface's CSP, 10-19). A srcdoc frame inherits
 * the embedding page's policy, so drawing a page there forced the surface to allow
 * inline styles; a frame loaded by URL carries only the policy its response names.
 *
 * A short-lived rendering cache, never a record: in memory, bounded, unjournaled.
 * Each entry belongs to the browser session that posted it (an anonymous,
 * HttpOnly, SameSite=Strict cookie set when the shell loads), and its id is random,
 * so a document cannot be fetched by guessing its content or from another session.
 */
import { randomBytes } from "node:crypto";

/** The frame's whole policy: nothing fetched, no script, sandboxed even when opened alone. */
export const FRAME_POLICY = [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  "img-src data:",
  "font-src data:",
  "media-src data:",
  "frame-ancestors 'self'",
  "sandbox",
].join("; ");
/** The part of the policy a <meta> can carry (sandbox and frame-ancestors only work as a header). */
const META_POLICY = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src data:";

export const FRAME_PATH = /^\/api\/page-frame\/[0-9a-f]{64}$/;
export const FRAME_COOKIE = "sf_frame";
export const FRAME_MAX_BYTES = 2 * 1024 * 1024;
const FRAME_MAX_ENTRIES = 64;
const FRAME_TTL_MS = 30 * 60_000;

export function pageDocument(source: string): string {
  return `<!doctype html><meta http-equiv="Content-Security-Policy" content="${META_POLICY}"><meta name="referrer" content="no-referrer">${source}`;
}

interface Entry {
  readonly session: string;
  readonly source: string;
  readonly doc: string;
  readonly at: number;
  /** Who stored it, as the write route admitted them (inbound-auth.ts): "browser-unverified" for the page. Written, not yet read. */
  readonly caller?: { readonly origin: string; readonly label: string };
}
const entries = new Map<string, Entry>();

function sweep(now: number): void {
  for (const [id, e] of entries) if (now - e.at > FRAME_TTL_MS) entries.delete(id);
  while (entries.size > FRAME_MAX_ENTRIES) {
    const oldest = entries.keys().next().value;
    if (oldest === undefined) break;
    entries.delete(oldest);
  }
}

/** Keep a page for this session; the same page in the same session keeps its id. */
export function storeFrame(session: string, source: string, now = Date.now(), caller?: { origin: string; label: string }): string {
  sweep(now);
  for (const [id, e] of entries) {
    if (e.session === session && e.source === source) {
      entries.delete(id);
      entries.set(id, { ...e, at: now });
      return id;
    }
  }
  const id = randomBytes(32).toString("hex");
  entries.set(id, { session, source, doc: pageDocument(source), at: now, ...(caller ? { caller } : {}) });
  sweep(now);
  return id;
}

/** The page kept under this id for this session, or null (unknown, expired, or another session's). */
/** Tests only: the caller stamp kept on a stored frame. */
export function __frameCallerForTests(id: string): { origin: string; label: string } | undefined {
  return entries.get(id)?.caller;
}

export function readFrame(session: string | null, id: string, now = Date.now()): string | null {
  sweep(now);
  const e = entries.get(id);
  return e && session !== null && e.session === session ? e.doc : null;
}

/** The frame session named by a request's Cookie header, if any. */
export function frameSessionOf(cookieHeader: string | undefined): string | null {
  const m = new RegExp(`(?:^|;\\s*)${FRAME_COOKIE}=([0-9a-f]{32})(?:;|$)`).exec(cookieHeader ?? "");
  return m?.[1] ?? null;
}

/** A Set-Cookie value for a new frame session. */
export function newFrameSessionCookie(): string {
  return `${FRAME_COOKIE}=${randomBytes(16).toString("hex")}; HttpOnly; SameSite=Strict; Path=/api/page-frame`;
}
