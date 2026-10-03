/**
 * Blind calibration grading of a declared sample.
 *
 * Shows a run's goal and what it produced, and nothing that carries the
 * system's verdict: no state, reason, answer card (it embeds the judge's
 * reason), route, credit, stalls, trace or ordinary grade gesture. The grader's
 * judgement is the measurement, so it must not be anchored on the judge's.
 *
 * Where a grade goes is the window's decision, not the page's: "report" keeps
 * grades in this browser and exports them as a file (nothing reaches the
 * system); "system" sends a calibration-only label the server re-checks.
 */

import { useMutation } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  submitCalibrationGrade,
  useCalibrationWindows,
  type CalibrationGrade,
  type CalibrationWindow,
} from "../api/calibration";
import { useWalk } from "../api/queries";
import { Chain } from "./Chain";

interface StoredGrade {
  readonly grade: CalibrationGrade;
  readonly notes: string;
  readonly graded_at: string;
}
type Grades = Readonly<Record<string, StoredGrade>>;

const GRADES: readonly { id: CalibrationGrade; label: string }[] = [
  { id: "reached", label: "Reached" },
  { id: "partial", label: "Partial" },
  { id: "not_reached", label: "Not reached" },
];

function storageKey(w: CalibrationWindow): string {
  return `sf-calibration:${w.window_id}:${w.sample_draw_id}`;
}

function loadGrades(w: CalibrationWindow): Grades {
  try {
    const raw = window.localStorage.getItem(storageKey(w));
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" ? (parsed as Grades) : {};
  } catch {
    return {};
  }
}

function saveGrades(w: CalibrationWindow, grades: Grades): void {
  try {
    window.localStorage.setItem(storageKey(w), JSON.stringify(grades));
  } catch {
    /* storage unavailable: grades stay in memory for this page */
  }
}

export function reportOf(w: CalibrationWindow, grades: Grades, exportedAt: string): Record<string, unknown> {
  return {
    window_id: w.window_id,
    sample_draw_id: w.sample_draw_id,
    seed: w.seed,
    label_sink: w.label_sink,
    exported_at: exportedAt,
    grades: w.dispatch_ids
      .filter((id) => grades[id])
      .map((id) => ({ dispatch_id: id, ...grades[id] })),
  };
}

function download(w: CalibrationWindow, grades: Grades): void {
  const blob = new Blob([JSON.stringify(reportOf(w, grades, new Date().toISOString()), null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `calibration-${w.window_id}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function BlindRun({
  window: w,
  dispatchId,
  saved,
  onSaved,
}: {
  window: CalibrationWindow;
  dispatchId: string;
  saved: StoredGrade | null;
  onSaved: (g: StoredGrade) => void;
}): ReactNode {
  const query = useWalk(dispatchId, { enabled: true, intervalMs: 60_000 });
  const [grade, setGrade] = useState<CalibrationGrade | null>(saved?.grade ?? null);
  const [notes, setNotes] = useState(saved?.notes ?? "");
  useEffect(() => {
    setGrade(saved?.grade ?? null);
    setNotes(saved?.notes ?? "");
  }, [dispatchId, saved]);

  const mutation = useMutation({
    retry: false,
    mutationFn: async (g: StoredGrade) => {
      if (w.label_sink === "system") {
        await submitCalibrationGrade({ windowId: w.window_id, dispatchId, grade: g.grade, notes: g.notes });
      }
      return g;
    },
    onSuccess: onSaved,
  });

  const walk = query.data;
  if (!walk) return <p className="sf-main-empty">{query.isError ? "Unreadable" : "Loading…"}</p>;
  const dirty = grade !== (saved?.grade ?? null) || notes.trim() !== (saved?.notes ?? "");

  return (
    <article className="sf-run sf-calibration-run" data-blind="true">
      <header className="sf-view-head">
        <h2 className="sf-view-title sf-run-title">{walk.goal ?? <span className="sf-muted">no goal text</span>}</h2>
        {walk.status === "running" ? <p className="sf-view-facts"><span className="sf-chip">running</span></p> : null}
      </header>

      <Chain walk={walk} blind />

      <form
        className="sf-view-section sf-calibration-grade"
        aria-label="Grade"
        onSubmit={(e) => {
          e.preventDefault();
          if (grade) mutation.mutate({ grade, notes: notes.trim(), graded_at: new Date().toISOString() });
        }}
      >
        <div className="sf-segmented" role="group" aria-label="Grade">
          {GRADES.map((g) => (
            <button key={g.id} type="button" aria-pressed={grade === g.id} onClick={() => setGrade(g.id)}>
              {g.label}
            </button>
          ))}
        </div>
        <textarea
          className="sf-run-question-input"
          aria-label="Notes"
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
        <div className="sf-run-question-actions">
          <button type="submit" className="sf-button" disabled={!grade || mutation.isPending || (!dirty && saved !== null)}>
            {saved && !dirty ? "Saved" : "Save"}
          </button>
          {mutation.isError ? <span className="sf-error-inline">Not saved: {(mutation.error as Error).message}</span> : null}
        </div>
      </form>
    </article>
  );
}

export function CalibrationPage({ windowId, onExit }: { windowId: string; onExit: () => void }): ReactNode {
  const q = useCalibrationWindows();
  const w = q.data?.windows.find((x) => x.window_id === windowId) ?? null;
  const [grades, setGrades] = useState<Grades>({});
  const [selected, setSelected] = useState(0);
  useEffect(() => {
    if (w) setGrades(loadGrades(w));
  }, [w?.window_id, w?.sample_draw_id]);
  const graded = useMemo(() => (w ? w.dispatch_ids.filter((id) => grades[id]).length : 0), [w, grades]);

  if (q.isLoading) return <p className="sf-main-empty">Loading…</p>;
  if (!w) {
    return (
      <div className="sf-calibration">
        <p className="sf-main-empty" title={q.data?.reason ?? undefined}>
          Unavailable{" "}
          <button type="button" className="sf-button sf-button-quiet" onClick={onExit}>
            Back
          </button>
        </p>
      </div>
    );
  }

  const current = w.dispatch_ids[Math.min(selected, w.dispatch_ids.length - 1)] ?? null;
  const onSaved = (id: string) => (g: StoredGrade): void => {
    const next = { ...grades, [id]: g };
    setGrades(next);
    saveGrades(w, next);
  };

  return (
    <div className="sf-calibration">
      <header className="sf-calibration-head">
        <h1 className="sf-view-label">Calibration</h1>
        <span className="sf-mono sf-muted" title={`draw ${w.sample_draw_id}`}>{w.window_id}</span>
        <span className="sf-chip">{graded} / {w.dispatch_ids.length}</span>
        <span className="sf-calibration-actions">
          {w.label_sink === "report" ? (
            <button type="button" className="sf-button sf-button-quiet" disabled={graded === 0} onClick={() => download(w, grades)}>
              Download
            </button>
          ) : null}
          <button type="button" className="sf-button sf-button-quiet" onClick={onExit}>
            Back
          </button>
        </span>
      </header>
      <ol className="sf-calibration-list" aria-label="Sample">
        {w.dispatch_ids.map((id, i) => (
          <li key={id}>
            <button type="button" aria-pressed={i === selected} onClick={() => setSelected(i)} title={id}>
              {i + 1}
              {grades[id] ? <span aria-label="graded"> ✓</span> : null}
            </button>
          </li>
        ))}
      </ol>
      <main className="sf-calibration-body">
        {current ? (
          <BlindRun key={current} window={w} dispatchId={current} saved={grades[current] ?? null} onSaved={onSaved(current)} />
        ) : null}
      </main>
    </div>
  );
}
