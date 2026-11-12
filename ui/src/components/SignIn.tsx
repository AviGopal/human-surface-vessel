/**
 * Sign in, in the top bar: the one place on the surface that takes something
 * other than the box. A password typed into the box would be echoed back and
 * read as a message, so the key gets its own field (user ruling 10-24). A person's rows (an
 * ask, a verdict) are written under it.
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
  const [key, setKey] = useState("");

  const state = session.data;
  if (!state?.keySignIn) return null;

  if (state.signedIn && state.person) {
    // A key sign-in carries no name: the words say signed in, and which key is one hover away
    // (a person may hold more than one), not a key id on the bar.
    const who = state.person.name ?? state.person.email ?? "Signed in";
    return (
      <span className="sf-signin" data-signed-in="true">
        <span className="sf-signin-who" title={state.person.email ?? state.person.userId}>
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
    signIn.mutate(key, {
      onSuccess: () => {
        setKey("");
        setOpen(false);
        onSignedIn?.();
      },
      onError: () => {
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
          <input type="password" name="key" autoComplete="off" placeholder="Your key" aria-label="Your key" value={key} onChange={(e) => setKey(e.target.value)} required />
          <button type="submit" className="sf-button" disabled={signIn.isPending || !key}>
            Sign in
          </button>
          {signIn.isError ? <p className="sf-signin-error" role="alert">{(signIn.error as Error).message}</p> : null}
        </form>
      ) : null}
    </span>
  );
}
