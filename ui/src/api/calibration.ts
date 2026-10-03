/**
 * Calibration windows and grades. A window is a declared, operator-attested
 * sample of runs; the server re-validates it on every read and every grade.
 */

import { useQuery, type UseQueryResult } from "@tanstack/react-query";

export type CalibrationGrade = "reached" | "partial" | "not_reached";

export interface CalibrationWindow {
  readonly window_id: string;
  readonly sample_draw_id: string;
  readonly seed: string | null;
  readonly label_sink: "report" | "system";
  readonly closes_at: number;
  readonly dispatch_ids: readonly string[];
}

export interface CalibrationWindows {
  readonly windows: readonly CalibrationWindow[];
  readonly reason: string | null;
}

export async function fetchCalibrationWindows(): Promise<CalibrationWindows> {
  const res = await fetch("/api/calibration/windows", { credentials: "same-origin" });
  if (!res.ok) return { windows: [], reason: `HTTP ${res.status}` };
  const j = (await res.json().catch(() => null)) as Partial<CalibrationWindows> | null;
  return { windows: Array.isArray(j?.windows) ? j.windows : [], reason: typeof j?.reason === "string" ? j.reason : null };
}

export function useCalibrationWindows(): UseQueryResult<CalibrationWindows> {
  return useQuery({
    queryKey: ["calibration", "windows"],
    queryFn: fetchCalibrationWindows,
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
  });
}

/** System sink only. The server refuses anything outside an attested window with sink "system". */
export async function submitCalibrationGrade(g: {
  windowId: string;
  dispatchId: string;
  grade: CalibrationGrade;
  notes: string;
}): Promise<void> {
  const res = await fetch("/api/calibration/grade", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ window_id: g.windowId, dispatch_id: g.dispatchId, grade: g.grade, notes: g.notes }),
  });
  if (!res.ok) {
    const j = (await res.json().catch(() => null)) as { error?: unknown } | null;
    throw new Error(typeof j?.error === "string" ? j.error : `HTTP ${res.status}`);
  }
}
