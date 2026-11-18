/**
 * Writes what the page shows the signed-in person (src/lib/shown.ts) as the page settles: after rows
 * arrive or change, and after the person scrolls or resizes, once the page has been still for
 * SETTLE_MS. Signed out, it measures nothing and writes nothing; a write refused as signed out stops
 * it until the session reads as signed in again.
 */
import { useEffect, useRef, type RefObject } from "react";
import { useSession } from "../api/session";
import { writeShown } from "../api/client";
import { readConditions } from "../lib/exposure";
import { ShownGate, shownOn, shownRow } from "../lib/shown";

/** How long the page is still before what it shows is measured: a row passing under a scroll was not shown. */
const SETTLE_MS = 1_000;

export function useShownRecorder(root: RefObject<HTMLElement | null>, presentation: string | null): void {
  const signedIn = useSession().data?.signedIn === true;
  const gate = useRef(new ShownGate());
  const latest = useRef(presentation);
  latest.current = presentation;

  useEffect(() => {
    const el = root.current;
    if (!signedIn || !el || typeof window === "undefined") return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const later = (ms: number) => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(measure, ms);
    };
    function measure(): void {
      timer = null;
      if (stopped) return;
      const shown = shownOn(el!, { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight });
      if (shown.length === 0) return;
      const now = Date.now();
      const due = gate.current.check(shown, now);
      if (due === "same") return;
      if (typeof due === "number") return later(due);
      gate.current.wrote(shown, now);
      void writeShown(shownRow(shown, readConditions(window), new Date(now), latest.current)).then((w) => {
        if (!w.ok && w.signedOut) stopped = true;
      });
    }
    const settle = () => later(SETTLE_MS);
    const observer = new MutationObserver(settle);
    observer.observe(el, { childList: true, subtree: true });
    window.addEventListener("scroll", settle, { passive: true });
    window.addEventListener("resize", settle);
    settle();
    return () => {
      stopped = true;
      if (timer !== null) clearTimeout(timer);
      observer.disconnect();
      window.removeEventListener("scroll", settle);
      window.removeEventListener("resize", settle);
    };
    // Re-armed once the landing is drawn: it is not there while its view is still being read.
  }, [signedIn, root, presentation !== null]);
}
