/**
 * THE PLANNER HAD NO TESTS. `planContent` decides how every impulse on this
 * surface is drawn and `ui/` ships no test runner at all, so the single most
 * important renderer's routing was covered by nothing. This file is that cover,
 * written around the scalar-rescue fix and deliberately wider than it.
 *
 * The fix's own claim — from a census of 126 real impulses off the live pool —
 * is that 35 short single-line values were being drawn as monospace code
 * listings. The tests below pin the rescue, and then spend most of their length
 * on what the rescue must NOT do: every falsifier here fails if the rescue is
 * widened by one condition.
 */

import { describe, expect, test } from "bun:test";
import { planContent } from "../ui/src/lib/ledger.ts";

/** Shapes seen carrying bare single-line values in the live census. */
const LIVE_BARE_VALUES: ReadonlyArray<readonly [string, string]> = [
  ["dispatch_id", "7068e05f-88e6-48e7-8fea-e449fa954f32"],
  ["due_score", "0.82"],
  ["rhythm_id", "rhythm-nightly"],
  ["folder", "/workspace/git/super-repo"],
  ["execute", "true"],
];

describe("the scalar rescue", () => {
  test("every bare single-line value from the live census reads as a value", () => {
    for (const [shape, text] of LIVE_BARE_VALUES) {
      const plan = planContent(shape, text, false);
      expect(plan.form).toBe("scalar");
      // The ORIGINAL bytes are what gets drawn. A rescue that reformatted the
      // value would be a coercion, not a routing fix.
      expect(plan.text).toBe(text);
    }
  });

  test("a bare number that is the answer to a goal is a value, not a listing", () => {
    // The instance that motivated this: the goal asked for the product, the
    // walk produced 82920, and the surface drew it as machine output.
    expect(planContent("answer", "82920", false).form).toBe("scalar");
  });

  test("POSITIVE CONTROL: the JSON-wrapped path is unchanged", () => {
    // This already worked. If the rescue broke it, the fix would have moved the
    // bug rather than closed it — and the label, which only the wrapper path
    // can know, must survive.
    const plan = planContent("goal", '{"goal":"Compute the product 120*691"}', false);
    expect(plan.form).toBe("scalar");
    expect(plan.label).toBe("goal");
    expect(plan.text).toBe("Compute the product 120*691");
  });
});

describe("FALSIFIERS — each one fails if the rescue is widened", () => {
  test("a TRUNCATED short line is never a value", () => {
    // The load-bearing exclusion. `scalar` draws a complete value beside a copy
    // button; a prefix drawn that way asserts completeness and hands the reader
    // a control that copies a fragment.
    const plan = planContent("codeReadResult", "export function heuristicForm(", true);
    expect(plan.form).not.toBe("scalar");
  });

  test("a multi-line value is never a value", () => {
    const plan = planContent("git_status", "M src/a.ts\nM src/b.ts", false);
    expect(plan.form).not.toBe("scalar");
  });

  test("a single line longer than the scalar cap is never a value", () => {
    const plan = planContent("note", "x".repeat(301), false);
    expect(plan.form).not.toBe("scalar");
  });

  test("an unparseable structured fragment is never a value", () => {
    // `heuristicForm`'s opener guard put this on the default branch ON PURPOSE.
    // Rescuing it would overturn the guard rather than rescue what the guard
    // was not aimed at.
    for (const fragment of ['{"a":1', "[1,2", '{"id":"x"}extra']) {
      expect(planContent("substrateGap", fragment, false).form).not.toBe("scalar");
    }
  });

  test("an empty preview stays empty, not a zero-length value", () => {
    // 22 of 126 live previews are zero-length `memoryNote` reads. "Carries a
    // shape and nothing else" is a different fact from "the value is blank".
    expect(planContent("memoryNote", "", false).form).toBe("empty");
    expect(planContent("memoryNote", "   ", false).form).toBe("empty");
  });
});

describe("NON-REGRESSION — the rescue runs last and takes from nothing", () => {
  test("a diff is still a diff", () => {
    const plan = planContent("codeChange", "diff --git a/x b/x\n+added\n-removed", false);
    expect(plan.form).toBe("diff");
  });

  test("a table is still a table", () => {
    const plan = planContent("metrics", '[{"a":1,"b":2},{"a":3,"b":4}]', false);
    expect(plan.form).toBe("rows");
  });

  test("prose is still prose", () => {
    const prose =
      "The user wants me to act as an agent that can help debug issues, so I " +
      "should leverage the provided tools to examine the codebase, understand " +
      "its structure, and identify the potential problems that are present.";
    expect(planContent("llm_completion_result", prose, false).form).toBe("prose");
  });

  test("a record is still a record", () => {
    const plan = planContent("memoryNote_write", '{"success":true,"shape":"memoryNote"}', false);
    expect(plan.form).toBe("record");
  });

  test("a provenance stub is still a stub", () => {
    const stub = '{"producedBy":"activity:⟨x⟩","executionId":"exec_1"}';
    expect(planContent("substrateGap", stub, false).form).toBe("stub");
  });

  test("command output is still terminal, and its columns are not reflowed", () => {
    const envelope = JSON.stringify({ stdout: "UNIT   LOAD   ACTIVE\na.service  loaded  active\n", exit_code: 0 });
    const plan = planContent("shellResult", envelope, false);
    expect(plan.form).toBe("terminal");
  });

  test("a one-line command output is a value, as it already was", () => {
    // The pre-existing `fromEnvelope` scalar branch. Named here so a future
    // change to the rescue cannot quietly take this path over.
    const plan = planContent("shellResult", JSON.stringify({ stdout: "1\n", exit_code: 0 }), false);
    expect(plan.form).toBe("scalar");
  });

  test("P9: an unrecognised shape with unrecognisable content still lands on verbatim", () => {
    // The designed common case. A surface that renders blank for the shapes
    // nobody anticipated has failed at the moment it mattered.
    const plan = planContent("a shape nobody registered", " not text\n at all\n", false);
    expect(plan.form).toBe("text");
    expect(plan.text).toBe(" not text\n at all\n");
  });

  test("a human's pin still overrides the rescue", () => {
    // Law 1: the shaped impulse decides, and it decides LAST-word, not
    // first-guess. A pin must beat a rescued default.
    const plan = planContent("dispatch_id", "7068e05f-88e6-48e7-8fea-e449fa954f32", false, {
      dispatch_id: "text",
    });
    expect(plan.form).toBe("text");
  });
});

describe("a cut envelope whose shape is not the first key", () => {
  test("the LLM resolver's {resolved, shape, content} draws its content, not 'resolved true · cut off'", async () => {
    const { truncatedEnvelopePayload } = await import("../ui/src/lib/ledger");
    const cut = '{"resolved":true,"shape":"llmCompletion","content":"Today\\u2019s report:\\n1. Headline one';
    const r = truncatedEnvelopePayload(cut);
    expect(r?.envelopeShape).toBe("llmCompletion");
    expect(r?.text.startsWith("Today’s report:\n1. Headline one")).toBe(true);
  });
  test("no declared shape among the leading pairs: declined, as before", async () => {
    const { truncatedEnvelopePayload } = await import("../ui/src/lib/ledger");
    expect(truncatedEnvelopePayload('{"resolved":true,"content":"text that was cut')).toBeNull();
  });
});

describe("authored content inside an envelope is planned as text, command streams as a terminal", () => {
  const report = "Here's a report on today.\n\n**Major Headlines and Commentary:**\n\n1. **Tensions rise.** Several outlets report that the situation escalated overnight, and analysts expect further moves this week.\n2. **Protests spread.** Schools closed across the country as demonstrations continued for a third day.";
  test("a cut {resolved, shape, content} report is prose, not a terminal block", async () => {
    const { planContent } = await import("../ui/src/lib/ledger");
    const cut = JSON.stringify({ resolved: true, shape: "llmCompletion", content: report }).slice(0, 300);
    const plan = planContent("llm_completion", cut, true);
    expect(plan.form).not.toBe("terminal");
    expect(plan.text.startsWith("Here's a report on today.")).toBe(true);
  });
  test("a cut {shape, stdout} listing stays a terminal block", async () => {
    const { planContent } = await import("../ui/src/lib/ledger");
    const listing = "UNIT                 LOAD   ACTIVE SUB     DESCRIPTION\nfoo.service          loaded active running Foo daemon that does things\nbar.service          loaded active running Bar daemon that does more";
    const cut = JSON.stringify({ shape: "shellResult", stdout: listing }).slice(0, 180);
    expect(planContent("shellResult", cut, true).form).toBe("terminal");
  });
  test("a whole {resolved, shape, content} unwraps to its content", async () => {
    const { planContent } = await import("../ui/src/lib/ledger");
    const whole = JSON.stringify({ resolved: true, shape: "llmCompletion", content: report });
    const plan = planContent("llm_completion", whole, false);
    expect(plan.form).not.toBe("record");
    expect(plan.text.startsWith("Here's a report on today.")).toBe(true);
  });
});
