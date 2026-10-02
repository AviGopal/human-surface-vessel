/**
 * What this run taught the learner: the per-dispatch learning sink goal-host
 * serves on `goalWalkState.learning` — one α/β delta per credited or penalised
 * template, plus whether a goal path was recorded and gaps were filed.
 *
 * Structured on the record, so nothing here reads a log line. Since 574eea7
 * every step that fed a reached deliverable along a recorded edge is credited
 * once per dispatch; those arrive here as `dAlpha > 0` rows.
 */

import type { LearningConsequences } from "../api/types";

export interface CreditRow {
  readonly templateId: string;
  readonly dAlpha: number;
  readonly dBeta: number;
}

export interface RunCredit {
  /** Summed per template, credited first, then penalised. */
  readonly rows: readonly CreditRow[];
  readonly goalPathRecorded: boolean | null;
  readonly gapsFiled: number;
  readonly oracleLabelWritten: boolean | null;
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

export function readCredit(learning: LearningConsequences | null | undefined): RunCredit | null {
  if (!learning || typeof learning !== "object") return null;
  const deltas = Array.isArray(learning["alphaBetaDelta"]) ? (learning["alphaBetaDelta"] as unknown[]) : [];
  const byTemplate = new Map<string, { dAlpha: number; dBeta: number }>();
  for (const d of deltas) {
    if (!d || typeof d !== "object") continue;
    const r = d as Record<string, unknown>;
    const id = typeof r["templateId"] === "string" ? r["templateId"] : null;
    if (!id) continue;
    const cur = byTemplate.get(id) ?? { dAlpha: 0, dBeta: 0 };
    byTemplate.set(id, { dAlpha: cur.dAlpha + num(r["dAlpha"]), dBeta: cur.dBeta + num(r["dBeta"]) });
  }
  const rows = [...byTemplate.entries()]
    .map(([templateId, d]) => ({ templateId, ...d }))
    .filter((r) => r.dAlpha !== 0 || r.dBeta !== 0)
    .sort((a, b) => b.dAlpha - a.dAlpha || b.dBeta - a.dBeta || a.templateId.localeCompare(b.templateId));
  const gaps = learning["gapsFiled"];
  return {
    rows,
    goalPathRecorded: typeof learning["goalPathRecorded"] === "boolean" ? (learning["goalPathRecorded"] as boolean) : null,
    gapsFiled: Array.isArray(gaps) ? gaps.length : num(gaps),
    oracleLabelWritten: typeof learning["oracleLabelWritten"] === "boolean" ? (learning["oracleLabelWritten"] as boolean) : null,
  };
}

/** The delta a chain node's producer received, when its producer is a credited or penalised template. */
export function creditFor(producedBy: string | null, credit: RunCredit | null): CreditRow | null {
  if (!producedBy || !credit) return null;
  return credit.rows.find((r) => r.templateId === producedBy) ?? null;
}
