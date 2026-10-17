/**
 * A model's reply draws as its text, with model, usage and cost as chips, never
 * as a record. Shape: run 1fb9dd5e (10-15), "What are your thoughts about what
 * you have learned?": the reply carried an empty `executed_tool_calls` list, so
 * the whole reply was planned as a record and drawn as a cut-off field column.
 */
import { describe, expect, test } from "bun:test";
import { planContent } from "../ui/src/lib/ledger";

const reply = {
  success: true,
  shape: "llmTextCompletion",
  body: {
    text: "As an AI, my thoughts are different.\n\n1. **Scope of Knowledge**:\n   - I can access and process information.\n\nIn summary, I adapt within a session.",
    model: "deepseek/deepseek-chat-v3-0324",
    requested_model: "auto",
    usage: { input_tokens: 496, output_tokens: 340, cost_usd: 0.0002508 },
    executed_tool_calls: [],
  },
};

describe("a model's reply", () => {
  test("must-fail: an empty tool-call list does not turn the reply into a record", () => {
    const plan = planContent("llm_completion_dispatch", JSON.stringify(reply), false);
    expect(plan.form).not.toBe("record");
    expect(plan.label).toBe("text");
    const chips = (plan.meta ?? []).filter((m) => m.kind === "field").map((m) => (m as { key: string }).key);
    expect(chips).toEqual(["model", "requested_model", "usage"]);
  });

  test("a non-empty list still keeps the record, as before", () => {
    const withCalls = { ...reply, body: { ...reply.body, executed_tool_calls: [{ name: "shell", args: { command: "date" } }] } };
    expect(planContent("llm_completion_dispatch", JSON.stringify(withCalls), false).form).toBe("record");
  });
});
