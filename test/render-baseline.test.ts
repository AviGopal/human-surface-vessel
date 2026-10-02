/**
 * The render baseline, held against real content.
 *
 * `fixtures/render-census.json` is every distinct impulse preview, answer and
 * question body on the live surface on 2026-09-30 (50 runs + the question
 * list). Before the envelope unwraps and the partial JSON reader, 18 of 142
 * impulses with content were drawn as a raw text wall and 34 were drawn with
 * their transport wrapper (`success`/`shape`/`body`) as the visible record.
 * These tests pin the baseline so it cannot quietly regress.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { CUT_KEY, parsePartialJson, planContent } from "../ui/src/lib/ledger.ts";

interface Item {
  kind: "impulse" | "answer" | "question";
  shape: string;
  preview: string | null;
  chars?: number;
  truncated?: boolean;
}
const items: Item[] = JSON.parse(readFileSync(new URL("./fixtures/render-census.json", import.meta.url), "utf8")).items;
const impulses = items.filter((i) => i.kind === "impulse" && typeof i.preview === "string" && i.preview.trim().length > 0);

function parsed(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

describe("render baseline over the live census", () => {
  test("the fixture is the size it was captured at", () => {
    expect(impulses.length).toBeGreaterThanOrEqual(100);
  });

  test("under 5% of impulses with content fall to a raw text wall", () => {
    const text = impulses.filter((i) => planContent(i.shape, i.preview!, Boolean(i.truncated)).form === "text");
    expect(text.length / impulses.length).toBeLessThan(0.05);
  });

  test("no resolver reply wrapper is drawn as its own wrapper", () => {
    for (const i of impulses.filter((x) => !x.truncated)) {
      const o = parsed(i.preview!) as Record<string, unknown> | undefined;
      if (!o || typeof o !== "object" || Array.isArray(o)) continue;
      if (!("success" in o) || !("body" in o) || typeof o["body"] !== "object" || o["body"] === null) continue;
      const plan = planContent(i.shape, i.preview!, false);
      const drawn = parsed(plan.text) as Record<string, unknown> | undefined;
      expect(plan.decidedBy).toBe("resolver_envelope");
      if (drawn && typeof drawn === "object" && !Array.isArray(drawn)) {
        expect("success" in drawn && "body" in drawn).toBe(false);
      }
    }
  });

  test("every truncated JSON preview with a whole member is drawn as structure", () => {
    for (const i of impulses.filter((x) => x.truncated && /^\s*[[{]/.test(x.preview!))) {
      const plan = planContent(i.shape, i.preview!, true);
      if (plan.decidedBy === "truncated_envelope") continue;
      if (!parsePartialJson(i.preview!)) continue;
      expect(plan.form).not.toBe("text");
    }
  });

  test("the partial reader never invents: every kept top-level member is verbatim in the preview", () => {
    let checked = 0;
    for (const i of impulses.filter((x) => x.truncated)) {
      const r = parsePartialJson(i.preview!);
      if (!r || typeof r.value !== "object" || r.value === null || Array.isArray(r.value)) continue;
      const o = r.value as Record<string, unknown>;
      for (const [k, v] of Object.entries(o)) {
        if (k === CUT_KEY) continue;
        const holdsCut = JSON.stringify(v).includes(CUT_KEY) || (Array.isArray(v) && k === Object.keys(o).filter((x) => x !== CUT_KEY).at(-1));
        if (holdsCut) continue; // the member the cut fell inside is partial by design
        expect(i.preview!).toContain(`${JSON.stringify(k)}:${JSON.stringify(v)}`);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(10);
  });
});

describe("planner branches", () => {
  test("resolver wrapper unwraps to its body, with the declared shape as a chip", () => {
    const p = planContent("gate_self_probe", JSON.stringify({ success: true, shape: "gateSelfProbe", body: { outcomes: [{ rule: "a", ok: true }] } }), false);
    expect(p.decidedBy).toBe("resolver_envelope");
    expect(p.form).toBe("record");
    expect(JSON.parse(p.text)).toEqual({ outcomes: [{ rule: "a", ok: true }] });
    expect(p.envelopeShape).toBe("gateSelfProbe");
  });

  test("a failed resolver reply carries a failure chip", () => {
    const p = planContent("x", JSON.stringify({ success: false, shape: "x", body: { reason: "nope" }, error: "boom" }), false);
    expect(p.meta?.some((m) => m.kind === "failure" && m.text === "boom")).toBe(true);
  });

  test("a command result nested in a resolver reply becomes the command output with its exit code", () => {
    const p = planContent("git_commit", JSON.stringify({ success: true, shape: "commandResult", body: { exitCode: 128, stdout: "", stderr: "fatal: not a git repository\n" } }), false);
    expect(p.decidedBy).toBe("resolver_envelope");
    expect(p.text).toContain("fatal: not a git repository");
    expect(p.meta?.some((m) => m.kind === "exit" && m.code === 128)).toBe(true);
  });

  test("content carried as an encoded string is parsed once, with the wrapper's summary as a note", () => {
    const p = planContent("test_report", JSON.stringify({ success: true, content: JSON.stringify({ total: 1, entries: [{ a: 1 }] }), metadata: { shape: "test_report", summary: "1 test_report rows", rowCount: 1 } }), false);
    expect(p.decidedBy).toBe("content_envelope");
    expect(JSON.parse(p.text)).toEqual({ total: 1, entries: [{ a: 1 }] });
    expect(p.meta).toEqual([{ kind: "note", text: "1 test_report rows" }]);
  });

  test("an error reply reads as a failure, not a value", () => {
    const p = planContent("source_code", '{"error":"filePath is required"}', false);
    expect(p.decidedBy).toBe("error_envelope");
    expect(p.text).toBe("filePath is required");
    expect(p.meta?.[0]?.kind).toBe("failure");
  });

  test("a write receipt without a body stays a record", () => {
    expect(planContent("memoryNote_write", '{"success":true,"shape":"memoryNote"}', false).form).toBe("record");
  });

  test("a learned form applies below a pin", () => {
    const text = JSON.stringify({ a: 1, b: 2 });
    expect(planContent("s", text, false, undefined, { s: "rows" }).decidedBy).toBe("learned");
    expect(planContent("s", text, false, { s: "text" }, { s: "rows" }).decidedBy).toBe("pin");
    // A learned `stub` is refused exactly as a pinned one is.
    expect(planContent("s", text, false, undefined, { s: "stub" }).decidedBy).not.toBe("learned");
  });
});

describe("parsePartialJson", () => {
  test("keeps whole members, drops the one cut mid-string, marks the cut", () => {
    const r = parsePartialJson('{"a":1,"b":"whole","c":"cut mid');
    expect(r?.cut).toBe(true);
    expect(r?.value).toEqual({ a: 1, b: "whole", [CUT_KEY]: expect.any(String) });
  });

  test("a number running into the cut is not trusted", () => {
    expect(parsePartialJson('{"a":1,"n":12')?.value).toEqual({ a: 1, [CUT_KEY]: expect.any(String) });
  });

  test("the marker sits in the innermost object the cut fell in", () => {
    const r = parsePartialJson('{"gaps":[{"id":"g1","n":1},{"id":"g2","sum');
    const v = r?.value as { gaps: Record<string, unknown>[] };
    expect(v.gaps[0]).toEqual({ id: "g1", n: 1 });
    expect(v.gaps[1]).toEqual({ id: "g2", [CUT_KEY]: expect.any(String) });
    expect(CUT_KEY in (v as object)).toBe(false);
  });

  test("malformed before the cut, or nothing whole, is not read", () => {
    expect(parsePartialJson('{"a" 1,')).toBeNull();
    expect(parsePartialJson('{"a":"cut')).toBeNull();
    expect(parsePartialJson("plain text")).toBeNull();
  });

  test("a truncated resolver reply unwraps to the whole part of its body", () => {
    const p = planContent("activity_metrics", '{"success":true,"shape":"activity_metrics","body":{"template_count":100,"rows":[{"id":"a"},{"id":"b","x', true);
    expect(p.decidedBy).toBe("partial_json");
    expect(p.form).toBe("record");
    const v = JSON.parse(p.text);
    expect(v.template_count).toBe(100);
    expect(v.rows[0]).toEqual({ id: "a" });
  });
});
