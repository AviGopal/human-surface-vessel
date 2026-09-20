/** Durable exchange records, not a separate learner. Payloads remain intact. */
import { appendFileSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync } from "node:fs";
import { join } from "node:path";

const directory = join(process.env.WORKSPACE_ROOT ?? "/workspace", "interactor-log");
type Channel = "uiPanel_write" | "uiFeedback_write";

export function appendParticipation(channel: Channel, record: unknown): void {
  mkdirSync(directory, { recursive: true });
  const fd = openSync(join(directory, `${channel}.jsonl`), "a");
  try {
    // A leading newline isolates a partial last record left by a failed write.
    appendFileSync(fd, `\n${JSON.stringify(record)}\n`);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

export function readParticipation(channel: Channel): unknown[] {
  const file = join(directory, `${channel}.jsonl`);
  if (!existsSync(file)) return [];
  const records: unknown[] = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try { records.push(JSON.parse(line)); }
    catch { console.warn(`[human-surface] skipped an incomplete ${channel} journal record`); }
  }
  return records;
}
