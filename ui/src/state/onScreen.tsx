/**
 * The output on screen, shared so the one box can carry what "Show as" did: a
 * person types "show this as a table" and the lead answer redraws. The run's lead
 * answer registers itself here; nothing else does, so "this" is that answer.
 */

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { OnScreenReport } from "../api/types";

export interface OnScreenEntry {
  readonly shape: string;
  readonly form: string;
  /** Whether the content carries markup that can be drawn as a page. */
  readonly markup: boolean;
  readonly region: string | null;
  /** Redraw in this form and record the person's choice, with where it came from. */
  readonly choose: (form: string, origin: "box") => void;
}

interface OnScreenValue {
  readonly entry: OnScreenEntry | null;
  readonly set: (e: OnScreenEntry | null) => void;
}

const OnScreenContext = createContext<OnScreenValue | null>(null);

export function OnScreenProvider({ children }: { children: ReactNode }): ReactNode {
  const [entry, set] = useState<OnScreenEntry | null>(null);
  const value = useMemo(() => ({ entry, set }), [entry]);
  return <OnScreenContext.Provider value={value}>{children}</OnScreenContext.Provider>;
}

/** What is on screen, or null (nothing registered, or no provider mounted). */
export function useOnScreen(): OnScreenEntry | null {
  return useContext(OnScreenContext)?.entry ?? null;
}

/** The registrar a lead answer uses; null where no provider is mounted. */
export function useOnScreenRegistrar(): ((e: OnScreenEntry | null) => void) | null {
  return useContext(OnScreenContext)?.set ?? null;
}

/** What the server reads of it: the parts a reading needs, never the callback. */
export function onScreenReport(e: OnScreenEntry | null): OnScreenReport | null {
  return e ? { shape: e.shape, form: e.form, markup: e.markup, region: e.region } : null;
}
