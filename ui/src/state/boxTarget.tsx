/**
 * The input a person chose to supply to a running run ("Provide"), shared so the
 * run page selects it and the one box takes the text. Text has one place to go.
 */

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";

export interface SupplyTarget {
  readonly dispatchId: string;
  readonly shape: string;
}

interface BoxTargetValue {
  readonly target: SupplyTarget | null;
  readonly choose: (t: SupplyTarget | null) => void;
  /** The last input supplied, so the run page can show whether the walk took it. */
  readonly sent: SupplyTarget | null;
  readonly markSent: (t: SupplyTarget) => void;
  /** The result the run page shows as its answer, so a verdict typed in the box carries what it judged. */
  readonly judged: JudgedResult | null;
  readonly setJudged: (j: JudgedResult | null) => void;
}

export interface JudgedResult {
  readonly dispatchId: string;
  readonly about: Readonly<Record<string, string>>;
}

const BoxTargetContext = createContext<BoxTargetValue | null>(null);

export function BoxTargetProvider({ children }: { children: ReactNode }): ReactNode {
  const [target, choose] = useState<SupplyTarget | null>(null);
  const [sent, markSent] = useState<SupplyTarget | null>(null);
  const [judged, setJudged] = useState<JudgedResult | null>(null);
  const value = useMemo(() => ({ target, choose, sent, markSent, judged, setJudged }), [target, sent, judged]);
  return <BoxTargetContext.Provider value={value}>{children}</BoxTargetContext.Provider>;
}

/** Null where no provider is mounted (views drawn outside the app shell). */
export function useBoxTarget(): BoxTargetValue | null {
  return useContext(BoxTargetContext);
}
