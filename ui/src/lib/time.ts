/**
 * `startedAt` has arrived on the wire as both an ISO string and an epoch
 * number, and as null when the record lost it. Parse defensively: a NaN sort
 * key silently collapses the board's ordering, and NaN compares false against
 * everything, so the failure is invisible.
 */
export function parseStartedAt(v: string | number | null | undefined, fallback: number): number {
  if (typeof v === "number" && Number.isFinite(v)) {
    // Seconds vs milliseconds: anything below this threshold cannot be a
    // millisecond timestamp in this decade.
    return v < 1e12 ? v * 1000 : v;
  }
  if (typeof v === "string" && v.length > 0) {
    const parsed = Date.parse(v);
    if (Number.isFinite(parsed)) return parsed;
    const asNumber = Number(v);
    if (Number.isFinite(asNumber) && asNumber > 0) return asNumber < 1e12 ? asNumber * 1000 : asNumber;
  }
  return fallback;
}

/** Compact elapsed, for a cell that updates in place without moving its row. */
export function formatElapsed(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

export function formatDurationBand(lowSec: number, highSec: number): string {
  const fmt = (s: number): string => (s < 90 ? `${Math.round(s)} seconds` : `${Math.round(s / 60)} minutes`);
  return `${fmt(lowSec)} to ${fmt(highSec)}`;
}

export function formatChars(n: number): string {
  return n.toLocaleString("en-US");
}

export function formatClock(ms: number): string {
  const d = new Date(ms);
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
