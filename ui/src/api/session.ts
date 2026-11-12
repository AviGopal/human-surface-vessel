/**
 * A person signed in on this surface (server: src/person-session.ts). The page
 * never holds a credential: it sends the person's key once, and the
 * server keeps the session behind an HttpOnly cookie. What comes back is only
 * what can be shown: whether sign-in is offered here, and who is signed in
 * until when.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRecheck } from "../state/recheck";

export interface SessionPerson {
  readonly userId: string;
  readonly name: string | null;
  readonly email: string | null;
  readonly expiresAt: number;
}

export interface SessionState {
  /** Sign-in with the person's own key is offered here: a person's rows are written under it. */
  readonly keySignIn: boolean;
  readonly signedIn: boolean;
  readonly person?: SessionPerson;
}

export const SESSION_KEY = ["personSession"] as const;

export async function fetchSession(): Promise<SessionState> {
  const res = await fetch("/api/session", { credentials: "same-origin" });
  if (!res.ok) return { keySignIn: false, signedIn: false };
  return (await res.json()) as SessionState;
}

/** Sign in with the person's own key. It is sent once; the server keeps it, the page does not. */
export async function signInWithKey(key: string): Promise<SessionState> {
  const res = await fetch("/api/session/key", {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ key }),
  });
  const j = (await res.json().catch(() => null)) as null | (SessionState & { error?: string });
  if (!res.ok || !j?.signedIn) throw new Error(j?.error ?? "sign-in failed");
  return { keySignIn: true, signedIn: true, ...(j.person ? { person: j.person } : {}) };
}

export async function signOut(): Promise<void> {
  await fetch("/api/session/logout", { method: "POST", credentials: "same-origin" });
}

/** The session as last read; re-read on the policy's cadence so an expired one shows as signed out. */
export function useSession() {
  const recheck = useRecheck();
  return useQuery({ queryKey: SESSION_KEY, queryFn: fetchSession, refetchInterval: recheck.sessionMs, refetchOnWindowFocus: true, retry: false });
}

/**
 * The reads whose answer the server shapes by who is signed in, and only these: a report goes
 * only under the signed-in person's own key (src/routes/proxy.ts), a view and the questions name
 * a person only to them (src/unname.ts, src/routes/participation.ts). One list for both hooks, so a
 * read added here is re-read on sign-in and dropped on sign-out alike. Not here: the render policy
 * and the gap reads, which the surface makes under its own key whoever is looking.
 */
export const PER_SESSION: readonly (readonly string[])[] = [["report"], ["uiView"], ["humanQuestions"]];

/** Signing in reads them again at once, not on their next cycle. */
export function useSignIn() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (key: string) => signInWithKey(key),
    onSuccess: (state) => {
      client.setQueryData(SESSION_KEY, state);
      for (const queryKey of PER_SESSION) void client.invalidateQueries({ queryKey: [...queryKey] });
    },
  });
}

/** Signing out drops them at once, so nothing read for the person stays on the page, then reads them again. */
export function useSignOut() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: signOut,
    onSettled: () => {
      const before = client.getQueryData<SessionState>(SESSION_KEY);
      client.setQueryData<SessionState>(SESSION_KEY, { keySignIn: before?.keySignIn ?? true, signedIn: false });
      void client.invalidateQueries({ queryKey: SESSION_KEY });
      for (const queryKey of PER_SESSION) void client.resetQueries({ queryKey: [...queryKey] });
    },
  });
}
