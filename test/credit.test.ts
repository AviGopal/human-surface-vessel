/**
 * What a run taught the learner, read from the structured learning sink on
 * goalWalkState — never from walk-log lines.
 */
import { describe, expect, test } from "bun:test";
import { creditFor, readCredit } from "../ui/src/lib/credit";

describe("readCredit", () => {
  test("sums per template, credited first, penalised after", () => {
    const c = readCredit({
      alphaBetaDelta: [
        { templateId: "activity:⟨bad⟩", dAlpha: 0, dBeta: 2 },
        { templateId: "satisfier:web_search", dAlpha: 1, dBeta: 0 },
        { templateId: "activity:⟨bad⟩", dAlpha: 0, dBeta: 2 },
        { templateId: "satisfier:llm_completion", dAlpha: 1, dBeta: 0 },
      ],
      gapsFiled: [],
      goalPathRecorded: true,
      oracleLabelWritten: false,
    });
    expect(c?.rows).toEqual([
      { templateId: "satisfier:llm_completion", dAlpha: 1, dBeta: 0 },
      { templateId: "satisfier:web_search", dAlpha: 1, dBeta: 0 },
      { templateId: "activity:⟨bad⟩", dAlpha: 0, dBeta: 4 },
    ]);
    expect(c?.goalPathRecorded).toBe(true);
    expect(c?.gapsFiled).toBe(0);
  });

  test("no learning record is null, not 'nothing credited'", () => {
    expect(readCredit(null)).toBeNull();
    expect(readCredit(undefined)).toBeNull();
  });

  test("malformed rows are skipped, zero deltas dropped", () => {
    const c = readCredit({ alphaBetaDelta: [null, { dAlpha: 1 }, { templateId: "x", dAlpha: 0, dBeta: 0 }, { templateId: "y", dAlpha: "1" }] });
    expect(c?.rows).toEqual([]);
  });

  test("creditFor matches a node's producer to its template's delta", () => {
    const c = readCredit({ alphaBetaDelta: [{ templateId: "satisfier:web_search", dAlpha: 1, dBeta: 0 }] });
    expect(creditFor("satisfier:web_search", c)?.dAlpha).toBe(1);
    expect(creditFor("satisfier:other", c)).toBeNull();
    expect(creditFor(null, c)).toBeNull();
  });
});
