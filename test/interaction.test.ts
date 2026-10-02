/**
 * The interaction payloads are pinned to what each widget sent before the
 * widgets were rebuilt on the shared contract: the writes, and so the stores
 * and learners behind them, see no change.
 */
import { describe, expect, test } from "bun:test";
import {
  complaintPayload,
  contributionContent,
  gradePayload,
  humanChoice,
  injectPayload,
  questionForAsk,
  solicitationPayload,
} from "../ui/src/lib/interaction";

describe("payload parity", () => {
  test("grade: a challenged reach is not_achieved, notes join option and note", () => {
    expect(gradePayload({ renderedState: "reached", option: "Didn't do it", note: "  it printed nothing ", executionId: "e1", goal: "g" })).toEqual({
      executionId: "e1",
      goal: "g",
      verdict: "not_achieved",
      notes: "Didn't do it — it printed nothing",
    });
    expect(Object.keys(gradePayload({ renderedState: "reached", option: "x", note: "", executionId: "e", goal: "g" }))).toEqual([
      "executionId",
      "goal",
      "verdict",
      "notes",
    ]);
  });

  test("grade: only 'It actually worked' flips a non-reach to achieved; an empty note sends the option alone", () => {
    expect(gradePayload({ renderedState: "not-reached", option: "It actually worked", note: "", executionId: "e", goal: "g" }).verdict).toBe("achieved");
    const other = gradePayload({ renderedState: "not-reached", option: "Failed for a different reason", note: "   ", executionId: "e", goal: "g" });
    expect(other.verdict).toBe("not_achieved");
    expect(other.notes).toBe("Failed for a different reason");
  });

  test("waiting walk: the answer is trimmed, nothing else changes", () => {
    expect(solicitationPayload({ solicitationId: "s1", outcome: "answered", answer: " yes \n" })).toEqual({ solicitationId: "s1", outcome: "answered", answer: "yes" });
  });

  test("add context: shape and content trimmed", () => {
    expect(injectPayload({ dispatchId: "d", shape: " human_context ", content: " fact " })).toEqual({ dispatchId: "d", shape: "human_context", content: "fact" });
  });

  test("report: panel_id, kind, trimmed value — the keys the gap keyspace is built from", () => {
    expect(complaintPayload({ region: "the surface", kind: "wrong", text: " broken " })).toEqual({ panel_id: "the surface", kind: "wrong", value: "broken" });
  });

  test("question response: ask_id only on an answer to a part; a decline never carries one", () => {
    expect(contributionContent({ panelId: "p", revision: 2, askId: null, kind: "answer", value: "v" })).toEqual({ panel_id: "p", panel_revision: 2, kind: "answer", value: "v" });
    expect(contributionContent({ panelId: "p", revision: 2, askId: "a1", kind: "answer", value: 3 })).toEqual({ panel_id: "p", panel_revision: 2, ask_id: "a1", kind: "answer", value: 3 });
    expect("ask_id" in contributionContent({ panelId: "p", revision: 2, askId: "a1", kind: "dismiss", value: "" })).toBe(false);
  });
});

describe("typed questions", () => {
  test("a human choice is the model's answer shape, without a confidence it never gave", () => {
    const a = humanChoice("Inert — nothing changed");
    expect(a).toEqual({ type: "choice", choice: "Inert — nothing changed", probabilities: { "Inert — nothing changed": 1 } });
    expect("confidence" in a).toBe(false);
  });

  test("store ask types map onto question kinds; an unusable choice falls back to text", () => {
    expect(questionForAsk({ type: "choice", choices: ["a", "b"] })).toEqual({ kind: "choice", options: ["a", "b"] });
    expect(questionForAsk({ type: "choice" })).toEqual({ kind: "text" });
    expect(questionForAsk({ type: "number" })).toEqual({ kind: "number" });
    expect(questionForAsk({ type: "claim" })).toEqual({ kind: "text" });
  });
});
