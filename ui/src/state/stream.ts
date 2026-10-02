/**
 * The surface's own change channel: `/api/stream` (server-sent events).
 *
 * It carries STORE EVENTS — a panel was added or revised, the render policy
 * changed, feedback arrived — not content. Each event invalidates the query
 * that reads that store, so those views change when the data changes rather
 * than on the next poll. While the stream is connected, those polls fall back
 * to a slow safety cadence (`streamAwareInterval`); when it drops, they return
 * to the live interval. Walk progress is not on this channel (goal-host has no
 * stream) and keeps polling.
 *
 * Paused means held: while the reader has paused updates, events are ignored,
 * exactly as a poll would be.
 */

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useSyncExternalStore } from "react";

let connected = false;
const listeners = new Set<() => void>();
function setConnected(v: boolean): void {
  if (connected === v) return;
  connected = v;
  for (const l of listeners) l();
}

export function useStreamConnected(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => connected,
    () => false,
  );
}

/** The safety cadence used while events are arriving. */
export const STREAM_FALLBACK_MS = 60_000;

export function streamAwareInterval(intervalMs: number, isConnected: boolean): number {
  return isConnected ? Math.max(intervalMs, STREAM_FALLBACK_MS) : intervalMs;
}

/** Which queries each store event makes stale. */
export const EVENT_QUERIES: Readonly<Record<string, readonly (readonly string[])[]>> = {
  panel_added: [["humanQuestions"]],
  panel_updated: [["humanQuestions"]],
  feedback_received: [["humanQuestions"], ["interfaceGaps"]],
  // Literal rather than imported: api/queries imports this module.
  renderPolicy: [["renderPolicy"]],
  surface_intent: [["renderPolicy"]],
};

export function useStoreStream(paused: boolean): void {
  const qc = useQueryClient();
  useEffect(() => {
    if (typeof EventSource === "undefined") return;
    const es = new EventSource("/api/stream");
    es.addEventListener("hello", () => setConnected(true));
    es.onopen = () => setConnected(true);
    // EventSource reconnects on its own; until it does, polls run at the live rate.
    es.onerror = () => setConnected(false);
    const handlers = Object.entries(EVENT_QUERIES).map(([event, keys]) => {
      const h = (): void => {
        if (paused) return;
        for (const queryKey of keys) void qc.invalidateQueries({ queryKey: [...queryKey] });
      };
      es.addEventListener(event, h);
      return [event, h] as const;
    });
    return () => {
      for (const [event, h] of handlers) es.removeEventListener(event, h);
      es.close();
      setConnected(false);
    };
  }, [qc, paused]);
}
