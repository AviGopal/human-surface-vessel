/** Durable exchange records, not a separate learner. Payloads remain intact. */
import { appendFileSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync } from "node:fs";
import { join } from "node:path";

const directory = join(process.env.WORKSPACE_ROOT ?? "/workspace", "interactor-log");
type Channel = "uiPanel_write" | "uiFeedback_write";

/**
 * The single write/read boundary for the interactor log — which is why the
 * envelope is applied HERE and nowhere else: store.ts's replay predicates and
 * its in-memory record shape stay byte-identical, and there is exactly one
 * place a format question can be answered.
 *
 * `interactor-log/*.jsonl` is a SHARED corpus, not this vessel's private file.
 * human-surface's unit sets no WORKSPACE_ROOT (so it defaults to /workspace)
 * and development-vessel sets WORKSPACE_ROOT=/workspace, so both append to the
 * same directory. Its established format is the envelope
 * `{id, shape, visibility, received_at, pointer:{panel_id, kind, value, …}}`
 * written by development-vessel/src/resolvers/interactor-passthrough.ts:100-107,
 * read by TWO production consumers, guarded on the write side by that same
 * module's pointer.panel_id refusal (:72-95), and spoken by every line of the
 * live corpus. This vessel was writing a flat camelCase record instead, so every
 * human answer it stored was invisible to both consumers.
 *
 * Open gap: human-surface-participation-journal-records-unreadable-by-interactor-log-consumers.
 */

/*
 * The consumers that read these lines, and the exact field each one needs — no
 * field below is written without a named reader:
 *
 *   development-vessel/src/resolvers/solicitation-outcome-scan.ts:73-82
 *       pointer.panel_id  -> the answered-panel set
 *       pointer.kind      -> "dismiss" is EXCLUDED from that set, so a dismissal
 *                            must pass through verbatim and never be remapped
 *   development-vessel/src/resolvers/escalation-disposition-apply.ts:104-116
 *       pointer.panel_id  -> keys the answers map
 *       pointer.value     -> RAW human text; :168 regexes it (parseDisposition)
 *                            and :182 copies it into gap metadata, so it must
 *                            not be stringified
 *       id (TOP LEVEL)    -> recordId; :171 keys idempotence on it, so the
 *                            envelope's id must equal the feedback id
 *   validation/human-participation/stage4-trace.ts:120-123
 *       record.panelId ?? pointer.panel_id
 *
 * `shape`, `visibility`, `received_at`, `pointer.type` and `pointer.source`
 * exist because they are the passthrough envelope's own fields (:100-107) — this
 * writer joins an existing corpus rather than inventing a dialect of it.
 */

interface Envelope {
  id: string;
  shape: Channel;
  visibility: string;
  received_at: string;
  pointer: Record<string, unknown>;
  /** The vessel's own flat entry, verbatim — what its replay reads back. */
  record: unknown;
}

/**
 * Wrap a feedback entry in the shared envelope.
 *
 * Scoped to `uiFeedback_write` deliberately. `uiPanel_write` is left BARE — a
 * CONTROLLED ABSENCE, not an oversight: that channel has zero external readers
 * (`rg` over the fleet finds no consumer of uiPanel_write.jsonl) and no such
 * file exists in the live container, so wrapping it would migrate a corpus
 * nobody reads. What is NOT optional is that the read path below tolerates both
 * forms on BOTH channels, so switching this on later needs no second migration.
 */
function wrapFeedback(record: unknown): unknown {
  const r = record as {
    id?: unknown; panelId?: unknown; panelRevision?: unknown; askId?: unknown;
    kind?: unknown; value?: unknown; visibility?: unknown; receivedAt?: unknown;
  } | null;
  if (!r || typeof r !== "object" || typeof r.id !== "string" || typeof r.panelId !== "string") return record;
  const visibility = typeof r.visibility === "string" ? r.visibility : "public";
  const receivedAt = typeof r.receivedAt === "number" && Number.isFinite(r.receivedAt) ? r.receivedAt : Date.now();
  const envelope: Envelope = {
    id: r.id,
    shape: "uiFeedback_write",
    visibility,
    received_at: new Date(receivedAt).toISOString(),
    pointer: {
      type: "uiFeedback_write",
      id: r.id,
      panel_id: r.panelId,
      panel_revision: r.panelRevision,
      ask_id: r.askId,
      // Never remapped: a "dismiss" that arrived as an "answer" would convert a
      // human's decline into consent inside solicitation_outcome_scan.
      kind: r.kind,
      // RAW. Not JSON.stringify'd — parseDisposition regexes this text.
      value: r.value,
      visibility,
      source: "human-surface-vessel",
    },
    record,
  };
  return envelope;
}

export function appendParticipation(channel: Channel, record: unknown): void {
  const payload = channel === "uiFeedback_write" ? wrapFeedback(record) : record;
  mkdirSync(directory, { recursive: true });
  const fd = openSync(join(directory, `${channel}.jsonl`), "a");
  try {
    // A leading newline isolates a partial last record left by a failed write.
    appendFileSync(fd, `\n${JSON.stringify(payload)}\n`);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

const snakeToCamel = (k: string): string => k.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase());

/**
 * Three-way unwrap, applied to BOTH channels.
 *
 * This is not a nicety. Without case 3, rolling the vessel back to a build that
 * only understood the flat form would silently restore ZERO records from a
 * journal the new build wrote — executed and observed: an unpatched store
 * restored 0 panels from a patched journal. Without case 2, lines written by
 * development-vessel's passthrough (the same shared file, no `record` key) stay
 * unreadable to this vessel, which is the original defect with the arrow
 * reversed.
 */
function unwrap(raw: unknown): unknown {
  const rec = raw as { record?: unknown; pointer?: Record<string, unknown>; id?: unknown; visibility?: unknown; received_at?: unknown } | null;
  if (!rec || typeof rec !== "object") return raw;
  // 1. Our own envelope: the flat entry is carried verbatim.
  if (rec.record !== undefined && rec.record !== null) return rec.record;
  // 2. A bare envelope (development-vessel's passthrough form): synthesize the flat entry.
  const pointer = rec.pointer;
  if (pointer && typeof pointer === "object" && typeof pointer.panel_id === "string"
      && (raw as { panelId?: unknown }).panelId === undefined) {
    const flat: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(pointer)) {
      if (k === "type") continue;
      flat[snakeToCamel(k)] = v;
    }
    if (typeof rec.id === "string") flat.id = rec.id;
    if (typeof rec.visibility === "string") flat.visibility = rec.visibility;
    // store.ts:260 requires a NUMERIC receivedAt; a NaN would satisfy `typeof ===
    // "number"` and then poison every ordering, so only a parseable stamp is set.
    const parsed = typeof rec.received_at === "string" ? Date.parse(rec.received_at) : NaN;
    if (Number.isFinite(parsed)) flat.receivedAt = parsed;
    return flat;
  }
  // 3. A legacy flat line: unchanged.
  return raw;
}

export function readParticipation(channel: Channel): unknown[] {
  const file = join(directory, `${channel}.jsonl`);
  if (!existsSync(file)) return [];
  const records: unknown[] = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try { records.push(unwrap(JSON.parse(line))); }
    catch { console.warn(`[human-surface] skipped an incomplete ${channel} journal record`); }
  }
  return records;
}
