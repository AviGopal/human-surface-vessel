/**
 * Applies `renderPolicy.tokenOverrides` to :root at use time.
 *
 * This is the visible half of the law-1 fix. Token values ship in the bundle as
 * defaults; an override arrives as a shaped impulse on the live cadence and
 * repaints the running surface. A legibility gap the substrate detected can
 * therefore be FIXED WHILE SOMEONE IS LOOKING AT IT — no rebuild, no reload, no
 * deploy.
 *
 * Cleanup removes only the properties this hook set, so withdrawing an override
 * restores the shipped default rather than leaving a stale value behind.
 */
import { useEffect, useRef } from "react";

export function useTokenOverrides(
  overrides: Readonly<Record<string, string>> | undefined,
): void {
  const appliedRef = useRef<string[]>([]);

  useEffect(() => {
    const root = document.documentElement;
    for (const name of appliedRef.current) {
      if (!overrides || !(name in overrides)) root.style.removeProperty(name);
    }
    const next: string[] = [];
    for (const [name, value] of Object.entries(overrides ?? {})) {
      if (!name.startsWith("--")) continue;
      root.style.setProperty(name, value);
      next.push(name);
    }
    appliedRef.current = next;
  }, [overrides]);

  useEffect(
    () => () => {
      const root = document.documentElement;
      for (const name of appliedRef.current) root.style.removeProperty(name);
      appliedRef.current = [];
    },
    [],
  );
}
