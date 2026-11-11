/**
 * The interaction payloads are pinned to what each widget sent before the
 * widgets were rebuilt on the shared contract: the writes, and so the stores
 * and learners behind them, see no change.
 */
import { describe, expect, test } from "bun:test";
import {
  complaintPayload,
  contributionContent,
  humanChoice,
  questionForAsk,
} from "../ui/src/lib/interaction";

describe("payload parity", () => {
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
