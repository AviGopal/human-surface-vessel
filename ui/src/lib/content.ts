/**
 * CONTENT — everything the surface draws, from any source, in one shape.
 *
 * An adapter states what ARRIVED and how complete it is. It never chooses a
 * form: that is the planner's decision alone (`planContent`), so every form on
 * the page has one author and one recorded reason.
 */

import type { RawProvenance, WalkLogEntry } from "../api/types";
import { normalizeProvenance } from "./ledger";
import { walkLogText } from "./walk";

export type ContentState = "full" | "truncated" | "streaming" | "closed" | "failed" | "absent";
export type ContentOrigin = "impulse" | "response" | "stream" | "panel" | "text";

export interface Content {
  /** Routing and pin key. Never the renderer key. */
  readonly shape: string;
  readonly origin: ContentOrigin;
  /** Text as it arrived, or a parsed value (serialized for the planner). */
  readonly body: unknown;
  readonly state: ContentState;
  /** How much of the whole is here, when that is known. */
  readonly size?: { readonly shown: number; readonly total: number };
  readonly provenance?: {
    readonly producedBy?: string | null;
    readonly source?: string | null;
    readonly at?: number | null;
  };
}

/** The text the planner reads. A parsed value is serialized once, compactly. */
export function contentText(c: Content): string {
  if (typeof c.body === "string") return c.body;
  if (c.body === undefined || c.body === null) return "";
  try {
    return JSON.stringify(c.body) ?? "";
  } catch {
    return String(c.body);
  }
}

/** A pool impulse's provenance entry (a trace row). */
export function fromProvenance(raw: RawProvenance, source?: string | null, at?: number | null): Content | null {
  const e = normalizeProvenance(raw);
  if (!e) return null;
  const provenance = { producedBy: e.producedBy, source: source ?? null, at: at ?? null };
  if (e.kind === "empty") return { shape: e.shape, origin: "impulse", body: "", state: "absent", provenance };
  return {
    shape: e.shape,
    origin: "impulse",
    body: e.preview,
    state: e.truncated ? "truncated" : "full",
    size: { shown: e.preview.length, total: e.chars },
    provenance,
  };
}

/** A system question's body. */
export function fromPanel(shape: string, body: unknown): Content {
  return { shape, origin: "panel", body: typeof body === "string" ? body : body, state: "full" };
}

/** Something a person or a resolver sent back (a contribution, a reply body). */
export function fromResponse(shape: string, value: unknown, at?: number): Content {
  return { shape, origin: "response", body: value, state: "full", provenance: { at: at ?? null } };
}

/** Plain prose the surface is relaying (a reason, an error, a gap summary). */
export function fromText(shape: string, text: string, state: ContentState = "full"): Content {
  return { shape, origin: "text", body: text, state };
}

/** The walk's decision log: one line per entry, verbatim. */
export function fromLog(entries: readonly WalkLogEntry[]): Content {
  return { shape: "walk_log", origin: "text", body: entries.map((e) => walkLogText(e)).join("\n"), state: "full" };
}

/** Chunks arriving on a stream, accumulated. `done` closes it; `failed` says it broke. */
export function fromStream(shape: string, chunks: readonly string[], done: boolean, failed = false): Content {
  const body = chunks.join("");
  return { shape, origin: "stream", body, state: failed ? "failed" : done ? "closed" : "streaming", size: { shown: body.length, total: body.length } };
}

/** A normalized ledger entry (what the trace joins events against). */
export function fromLedgerEntry(
  e: import("./ledger").LedgerEntry,
  source?: string | null,
  at?: number | null,
): Content {
  const provenance = { producedBy: e.producedBy, source: source ?? null, at: at ?? null };
  if (e.kind === "empty") return { shape: e.shape, origin: "impulse", body: "", state: "absent", provenance };
  return {
    shape: e.shape,
    origin: "impulse",
    body: e.preview,
    state: e.truncated ? "truncated" : "full",
    size: { shown: e.preview.length, total: e.chars },
    provenance,
  };
}
