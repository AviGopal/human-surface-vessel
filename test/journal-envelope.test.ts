/**
 * FALSIFIER for the participation-journal envelope (Track B item B-4).
 *
 * Open gap: human-surface-participation-journal-records-unreadable-by-interactor-log-consumers
 * (detected 2026-09-20T04:54:05Z, status open, classification_metadata carries a `falsifier`
 * string and NO `edit_site`).
 *
 * The three clauses below run the extraction logic of the REAL production consumers, copied
 * verbatim from their source lines, over a journal line this vessel actually wrote. Copying the
 * consumer code (rather than asserting on our own field names) is the point: an assertion written
 * against the writer's vocabulary cannot fail when the writer is the side that diverged.
 *
 *  (a) solicitation-outcome-scan.ts:73-82   -> the answered-panel set must contain the panel id
 *  (b) escalation-disposition-apply.ts:104-116 -> {value, recordId}; value stays RAW so the real
 *      parseDisposition (same module, :71-81) yields the verb, and :182 copies that text into gap
 *      metadata unstringified
 *  (c) fresh-process replay of THREE line forms (wrapped / bare passthrough envelope / legacy flat)
 *  (d) kind:"dismiss" must NOT enter the answered set — the scan excludes dismissals, so a remap
 *      would turn a human's decline into an answer
 */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { recordFeedback } from "../src/store.ts";
import { parseDisposition } from "../../development-vessel/src/resolvers/escalation-disposition-apply.ts";

const journal = () =>
  readFileSync(join(process.env.WORKSPACE_ROOT!, "interactor-log", "uiFeedback_write.jsonl"), "utf8");

/** VERBATIM from repos/development-vessel/src/resolvers/solicitation-outcome-scan.ts:73-82. */
function answeredPanelsOf(text: string): Set<string> {
  const answeredPanels = new Set<string>();
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const rec = JSON.parse(line) as { pointer?: { panel_id?: string; kind?: string } };
      const pid = rec.pointer?.panel_id;
      if (typeof pid === "string" && pid && rec.pointer?.kind !== "dismiss") answeredPanels.add(pid);
    } catch { /* skip malformed line */ }
  }
  return answeredPanels;
}

/** VERBATIM from repos/development-vessel/src/resolvers/escalation-disposition-apply.ts:104-116. */
function answersByPanel(text: string): Map<string, { value: string; recordId: string }> {
  const out = new Map<string, { value: string; recordId: string }>();
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const rec = JSON.parse(line) as { id?: string; pointer?: { panel_id?: string; value?: unknown; kind?: string } };
      const pid = rec.pointer?.panel_id;
      if (typeof pid !== "string" || !pid) continue;
      if (rec.pointer?.kind === "dismiss") continue;
      const v = rec.pointer?.value;
      out.set(pid, { value: typeof v === "string" ? v : JSON.stringify(v ?? ""), recordId: String(rec.id ?? "") });
    } catch { /* skip malformed line */ }
  }
  return out;
}

describe("participation journal records are readable by the interactor-log consumers", () => {
  test("(a) a stored answer enters solicitation_outcome_scan's answered-panel set", () => {
    const panelId = `needs-human-envelope-a-${crypto.randomUUID()}`;
    recordFeedback({ panelId, kind: "answer", value: "the evidence is in trace 42" });
    expect([...answeredPanelsOf(journal())]).toContain(panelId);
  });

  test("(b) escalation_disposition_apply extracts the raw answer text and the record id", () => {
    const panelId = `needs-human-envelope-b-${crypto.randomUUID()}`;
    const answer = "Disposition: drop. Not worth closing — no caller can be named.";
    const entry = recordFeedback({ panelId, kind: "answer", value: answer });
    const extracted = answersByPanel(journal()).get(panelId);
    expect(extracted).toBeDefined();
    // RAW, not JSON.stringify'd: escalation-disposition-apply.ts:182 copies this straight into
    // gap metadata, and :168 regexes it. A quoted/escaped value would poison both.
    expect(extracted!.value).toBe(answer);
    expect(parseDisposition(extracted!.value)).toBe("drop");
    // escalation-disposition-apply.ts:171 keys idempotence on this id.
    expect(extracted!.recordId).toBe(entry.id);
  });

  test("(d) a dismissal stays out of the answered set", () => {
    const panelId = `needs-human-envelope-d-${crypto.randomUUID()}`;
    recordFeedback({ panelId, kind: "dismiss", value: "not mine to decide" });
    const text = journal();
    // POSITIVE CONTROL in the same read: an answer written to a sibling panel IS visible, so an
    // empty result here is attributable to the dismissal filter and not to an unreadable file.
    const answeredPanelId = `needs-human-envelope-d-control-${crypto.randomUUID()}`;
    recordFeedback({ panelId: answeredPanelId, kind: "answer", value: "control" });
    const set = answeredPanelsOf(journal());
    expect([...set]).toContain(answeredPanelId);
    expect([...set]).not.toContain(panelId);
    expect(text.length).toBeGreaterThan(0);
  });

  test("(c) a fresh process replays wrapped, bare-passthrough and legacy-flat lines alike", () => {
    const workspace = mkdtempSync(join(tmpdir(), "human-surface-envelope-"));
    mkdirSync(join(workspace, "interactor-log"), { recursive: true });
    const at = Date.now();
    const wrapped = {
      id: "fdbk-wrapped", shape: "uiFeedback_write", visibility: "public",
      received_at: new Date(at).toISOString(),
      pointer: { type: "uiFeedback_write", id: "fdbk-wrapped", panel_id: "panel-wrapped", kind: "answer", value: "wrapped answer", visibility: "public", source: "human-surface-vessel" },
      record: { id: "fdbk-wrapped", panelId: "panel-wrapped", kind: "answer", value: "wrapped answer", visibility: "public", receivedAt: at },
    };
    // development-vessel's interactor-passthrough.ts:100-107 form: envelope, NO `record`.
    const passthrough = {
      id: "fdbk-passthrough", shape: "uiFeedback_write", visibility: "public",
      received_at: new Date(at + 1).toISOString(),
      pointer: { type: "uiFeedback_write", panel_id: "panel-passthrough", kind: "answer", value: "passthrough answer" },
    };
    const legacy = { id: "fdbk-legacy", panelId: "panel-legacy", kind: "answer", value: "legacy answer", visibility: "public", receivedAt: at + 2 };
    writeFileSync(
      join(workspace, "interactor-log", "uiFeedback_write.jsonl"),
      [wrapped, passthrough, legacy].map(r => `\n${JSON.stringify(r)}\n`).join(""),
    );
    const module = new URL("../src/store.ts", import.meta.url).pathname;
    const child = Bun.spawnSync([process.execPath, "-e", `
      const store = await import(${JSON.stringify(module)});
      console.log(JSON.stringify(store.recentFeedback(50).map(f => [f.id, f.panelId, f.kind, f.value, typeof f.receivedAt])));
    `], { env: { ...process.env, WORKSPACE_ROOT: workspace } });
    rmSync(workspace, { recursive: true, force: true });
    expect(child.exitCode).toBe(0);
    const restored = JSON.parse(child.stdout.toString()) as string[][];
    expect(restored).toHaveLength(3);
    expect(restored).toEqual(expect.arrayContaining([
      ["fdbk-wrapped", "panel-wrapped", "answer", "wrapped answer", "number"],
      ["fdbk-passthrough", "panel-passthrough", "answer", "passthrough answer", "number"],
      ["fdbk-legacy", "panel-legacy", "answer", "legacy answer", "number"],
    ]));
  });
});
