/**
 * Sign in, in the top bar: the one place on the surface that takes something
 * other than the box. A password typed into the box would be echoed back and
 * read as a message, so credentials get their own fields (user ruling 10-24). Where a
 * person's own key is accepted, that is the one field: a verdict is written under it.
 * Nothing here is shown where sign-in isn't offered.
 */

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useSession, useSignIn, useSignOut } from "../api/session";

function until(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function SignIn({ onSignedIn, openSignal = 0 }: { onSignedIn?: () => void; openSignal?: number }): ReactNode {
  const session = useSession();
  const signIn = useSignIn();
  const signOut = useSignOut();
  const [open, setOpen] = useState(false);
  // Asked to open (an ask sent signed out): the form opens where the person is looking.
  useEffect(() => {
    if (openSignal > 0) setOpen(true);
  }, [openSignal]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [key, setKey] = useState("");

  const state = session.data;
  if (!state?.available && !state?.keySignIn) return null;
  const withKey = state.keySignIn === true;

  if (state.signedIn && state.person) {
    const who = state.person.name ?? state.person.email ?? (withKey ? `Signed in (${state.person.userId})` : "Signed in");
    return (
      <span className="sf-signin" data-signed-in="true">
        <span className="sf-signin-who" title={state.person.email ?? undefined}>
          {who} · until {until(state.person.expiresAt)}
        </span>
        <button type="button" className="sf-button sf-button-quiet" onClick={() => signOut.mutate()}>
          Sign out
        </button>
      </span>
    );
  }

  const submit = (e: FormEvent): void => {
    e.preventDefault();
    signIn.mutate(withKey ? { key } : { email, password }, {
      onSuccess: () => {
        setPassword("");
        setKey("");
        setOpen(false);
        onSignedIn?.();
      },
      onError: () => {
        setPassword("");
        setKey("");
      },
    });
  };

  return (
    <span className="sf-signin" data-signed-in="false">
      <button type="button" className="sf-button sf-button-quiet" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        Sign in
      </button>
      {open ? (
        <form className="sf-signin-form" onSubmit={submit} aria-label="Sign in">
          {withKey ? (
            <input type="password" name="key" autoComplete="off" placeholder="Your key" aria-label="Your key" value={key} onChange={(e) => setKey(e.target.value)} required />
          ) : (
            <>
              <input type="email" name="email" autoComplete="username" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              <input type="password" name="password" autoComplete="current-password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </>
          )}
          <button type="submit" className="sf-button" disabled={signIn.isPending || (withKey ? !key : !email || !password)}>
            Sign in
          </button>
          {signIn.isError ? <p className="sf-signin-error" role="alert">{(signIn.error as Error).message}</p> : null}
        </form>
      ) : null}
    </span>
  );
}
