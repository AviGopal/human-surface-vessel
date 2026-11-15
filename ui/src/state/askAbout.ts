import { useEffect, useState } from "react";
import type { About } from "../lib/box";

/**
 * The listed ask the person chose to ask about (askAbout, from its "about this"), held until the
 * box's next ask is stored or the person sets it aside: the next message cites it, and only that one.
 */
export function useAskAbout(): readonly [About | null, () => void] {
  const [about, setAbout] = useState<About | null>(null);
  useEffect(() => {
    const onAbout = (e: Event): void => setAbout((e as CustomEvent<About>).detail);
    window.addEventListener("sf:box-about", onAbout);
    return () => window.removeEventListener("sf:box-about", onAbout);
  }, []);
  return [about, () => setAbout(null)] as const;
}
