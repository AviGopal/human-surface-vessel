/**
 * A verdict and the person's reason for it are read as one, whatever separator the
 * person types between them. Only a colon counted, so a reason after a comma, typed
 * on a run's outcome, went out as a new ask and never reached the run.
 *
 * Shape: one node 10-27, a signed-in person's comma-separated verdict recorded as a
 * new dispatch instead of a verdict.
 */
import { describe, expect, test } from "bun:test";
import { readVerdict } from "../ui/src/lib/box";

describe("a verdict with its reason", () => {
  test("must-fail: a reason after a comma, semicolon, full stop or dash is the verdict's note", () => {
    for (const [text, note] of [
      ["Wrong answer, the list holds no choices for me", "Wrong answer — the list holds no choices for me"],
      ["Wrong answer; the dates are off", "Wrong answer — the dates are off"],
      ["Wrong answer. The dates are off", "Wrong answer — The dates are off"],
      ["wrong answer — try the web", "wrong answer — try the web"],
      ["Didn't do it, it asked me instead", "Didn't do it — it asked me instead"],
    ] as const) {
      expect(readVerdict(text)).toEqual({ verdict: "not_achieved", notes: note });
    }
    expect(readVerdict("that worked, thanks")).toEqual({ verdict: "achieved", notes: "that worked — thanks" });
  });

  test("a colon still works, and a bare phrase is its own note", () => {
    expect(readVerdict("wrong answer: Barcelona isn't in Italy")).toEqual({ verdict: "not_achieved", notes: "wrong answer — Barcelona isn't in Italy" });
    expect(readVerdict("Wrong answer")).toEqual({ verdict: "not_achieved", notes: "Wrong answer" });
  });

  test("an ask that only contains a verdict phrase stays an ask", () => {
    expect(readVerdict("wrong answers to common questions")).toBeNull();
    expect(readVerdict("Wrong answer about Paris and Rome, list them")).toBeNull();
    expect(readVerdict("Show me the wrong answers, please")).toBeNull();
    expect(readVerdict("wrong answer,")).toEqual({ verdict: "not_achieved", notes: "wrong answer" });
  });

  test("must-fail: after a reached verdict, a request is a new ask and the verdict is bare", () => {
    expect(readVerdict("That worked, now also show my open asks")).toEqual({ verdict: "achieved", notes: "That worked", ask: "now also show my open asks" });
    expect(readVerdict("That worked. Can you list the sources?")).toEqual({ verdict: "achieved", notes: "That worked", ask: "Can you list the sources?" });
    expect(readVerdict("correct, thanks")).toEqual({ verdict: "achieved", notes: "correct — thanks" });
  });

  test("after a not-reached verdict, what follows stays about that run, even when it reads as a request", () => {
    expect(readVerdict("wrong answer, try the web instead")).toEqual({ verdict: "not_achieved", notes: "wrong answer — try the web instead" });
    expect(readVerdict("wrong answer: why did it pick the shell?")).toEqual({ verdict: "not_achieved", notes: "wrong answer — why did it pick the shell?" });
  });
});
