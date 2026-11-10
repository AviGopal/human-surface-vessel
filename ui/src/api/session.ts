/**
 * A person signed in on this surface (server: src/person-session.ts). The page
 * never holds a credential: it sends the person's key (or email and password) once, and the
 * server keeps the session behind an HttpOnly cookie. What comes back is only
 * what can be shown: whether sign-in is offered here, and who is signed in
 * until when.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export interface SessionPerson {
  readonly userId: string;
  readonly name: string | null;
  readonly email: string | null;
  readonly expiresAt: number;
}

export interface SessionState {
  /** Sign-in with email and password is offered here. */
  readonly available: boolean;
  /** Sign-in with the person's own key is offered here: a person's rows are written under it. */
  readonly keySignIn?: boolean;
  readonly signedIn: boolean;
  readonly person?: SessionPerson;
}

export const SESSION_KEY = ["personSession"] as const;

export async function fetchSession(): Promise<SessionState> {
  const res = await fetch("/api/session", { credentials: "same-origin" });
  if (!res.ok) return { available: false, signedIn: false };
  return (await res.json()) as SessionState;
}

export async function signIn(email: string, password: string): Promise<SessionState> {
  const res = await fetch("/api/session/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ email, password }),
  });
  const j = (await res.json().catch(() => null)) as null | (SessionState & { error?: string });
  if (!res.ok || !j?.signedIn) throw new Error(j?.error ?? "sign-in failed");
  return { available: true, signedIn: true, ...(j.person ? { person: j.person } : {}) };
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
  return { available: false, keySignIn: true, signedIn: true, ...(j.person ? { person: j.person } : {}) };
}

export async function signOut(): Promise<void> {
  await fetch("/api/session/logout", { method: "POST", credentials: "same-origin" });
}

/** The session as last read; re-read each minute so an expired one shows as signed out. */
export function useSession() {
  return useQuery({ queryKey: SESSION_KEY, queryFn: fetchSession, refetchInterval: 60_000, refetchOnWindowFocus: true, retry: false });
}

export function useSignIn() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (c: { email: string; password: string } | { key: string }) => ("key" in c ? signInWithKey(c.key) : signIn(c.email, c.password)),
    onSuccess: (state) => client.setQueryData(SESSION_KEY, state),
  });
}

export function useSignOut() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: signOut,
    onSettled: () => void client.invalidateQueries({ queryKey: SESSION_KEY }),
  });
}
