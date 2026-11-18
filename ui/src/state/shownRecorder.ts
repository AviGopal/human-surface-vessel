/**
 * Writes what the page shows the signed-in person (src/lib/shown.ts) as the page settles: after rows
 * arrive or change, after the person scrolls or resizes, and when the page comes back into view, once
 * it has been still for SETTLE_MS. A page out of view (a tab behind others) shows no one anything, so
 * it measures nothing, however its rows change. Signed out, it measures nothing and writes nothing.
 *
 * A write refused as signed out stops this page writing until its session is read as signed out and
 * then in again, or the page is loaded again. A write that fails for any other reason is not tried
 * again: the set counts as written, so the page records less than it showed, never more.
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
      if (stopped || document.visibilityState !== "visible") return;
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
    document.addEventListener("visibilitychange", settle);
    settle();
    return () => {
      stopped = true;
      if (timer !== null) clearTimeout(timer);
      observer.disconnect();
      window.removeEventListener("scroll", settle);
      window.removeEventListener("resize", settle);
      document.removeEventListener("visibilitychange", settle);
    };
    // Re-armed once the landing is drawn: it is not there while its view is still being read.
  }, [signedIn, root, presentation !== null]);
}
