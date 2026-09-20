// Falsifiers for the importance scorer (src/importance.ts).
//
// The directive under test: "the system should always show what it thinks is
// most important". This file only covers the ORDERING half — that the order is
// produced by weights that are DATA, is explainable in words a human can
// disagree with, and never silently drops a panel it does not recognise.
//
// PROCESS-SHARED STORE WARNING (same one solicitation-store.test.ts carries):
// importing anything from ../src/store.ts runs that module's journal replay
// once per `bun test` process. This file therefore imports only the
// `isSolicitation` PREDICATE, constructs panels as plain object literals, and
// never calls upsertPanel/recordFeedback — so it writes nothing into the shared
// store and cannot flap when a sibling file is added or reordered.
//
// Run under the suite baseline:
//   bun test --preload ./test/setup.ts ./test/*.test.ts
import { describe, expect, test } from "bun:test";
import {
  DEFAULT_IMPORTANCE_WEIGHTS,
  explainRanking,
  rankPanels,
  scorePanel,
  type ImportanceWeights,
  type ScorablePanel,
} from "../src/importance.ts";
import { isSolicitation } from "../src/store.ts";

const DAY = 86_400_000;
const NOW = 1_790_000_000_000;

function panel(over: Partial<ScorablePanel> & { id: string }): ScorablePanel {
  return {
    title: "Gap needs a human decision",
    kind: "gap_needs_human",
    importance: "high",
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

describe("explainability (requirement 1)", () => {
  test("a stale unanswered escalation names every factor in human words", () => {
    const scored = scorePanel(
      panel({ id: "p1", kind: "gap_needs_human", createdAt: NOW - 6 * DAY }),
      DEFAULT_IMPORTANCE_WEIGHTS,
      NOW,
    );
    const because = scored.because.join(" | ");
    // The kind's meaning, not its identifier.
    expect(because).toContain("repeated failed repairs");
    expect(because).toContain("waiting 6 days");
    expect(because).toMatch(/no answer recorded/);
    expect(because).toContain("high");
    // Every reason is a non-empty human sentence fragment, not a number dump.
    for (const reason of scored.because) {
      expect(reason.length).toBeGreaterThan(8);
      expect(reason).toMatch(/[a-z]{3}/);
    }
  });

  test("answered and dismissed are DISTINCT reasons, never collapsed", () => {
    const answered = scorePanel(panel({ id: "p2", answered: true }), DEFAULT_IMPORTANCE_WEIGHTS, NOW);
    const dismissed = scorePanel(panel({ id: "p3", declined: true }), DEFAULT_IMPORTANCE_WEIGHTS, NOW);
    expect(answered.because.join(" ")).toContain("answered");
    expect(dismissed.because.join(" ")).toContain("dismissed");
    expect(answered.because.join(" ")).not.toContain("dismissed");
    expect(dismissed.because.join(" ")).not.toContain("you answered");
  });

  test("an unanswered panel with no recorded view state says so honestly", () => {
    const bare = scorePanel(panel({ id: "p4" }), DEFAULT_IMPORTANCE_WEIGHTS, NOW);
    // "no answer recorded" — NOT "you have not answered it", which would assert
    // a fact about the human that an absent view state does not support.
    expect(bare.because.join(" ")).toContain("no answer recorded");
  });
});

describe("determinism and total ordering (requirement 2)", () => {
  test("same inputs produce the same order, twice", () => {
    const panels = [
      panel({ id: "b", createdAt: NOW - 3 * DAY }),
      panel({ id: "a", kind: "question" }),
      panel({ id: "c", kind: "info" }),
    ];
    const first = rankPanels(panels, DEFAULT_IMPORTANCE_WEIGHTS, NOW).map(s => s.panel.id);
    const second = rankPanels(panels, DEFAULT_IMPORTANCE_WEIGHTS, NOW).map(s => s.panel.id);
    expect(first).toEqual(second);
    // Input order must not leak into output order.
    const shuffled = rankPanels([panels[2], panels[0], panels[1]], DEFAULT_IMPORTANCE_WEIGHTS, NOW)
      .map(s => s.panel.id);
    expect(shuffled).toEqual(first);
  });

  test("ties break by id ascending, not by time or arrival", () => {
    // Identical in every scored factor: only the id differs.
    const zed = panel({ id: "zzz", updatedAt: NOW });
    const abc = panel({ id: "aaa", updatedAt: NOW - 9 * DAY });
    const ranked = rankPanels([zed, abc], DEFAULT_IMPORTANCE_WEIGHTS, NOW);
    expect(ranked[0].score).toBe(ranked[1].score);
    expect(ranked.map(s => s.panel.id)).toEqual(["aaa", "zzz"]);
  });

  test("rankPanels does not mutate its input array", () => {
    const panels = [panel({ id: "m2", kind: "info" }), panel({ id: "m1", kind: "gap_needs_human" })];
    const order = panels.map(p => p.id);
    rankPanels(panels, DEFAULT_IMPORTANCE_WEIGHTS, NOW);
    expect(panels.map(p => p.id)).toEqual(order);
  });
});

describe("an unknown kind must not vanish (requirement 3)", () => {
  test("an invented kind scores at the neutral default and outranks a known-low kind", () => {
    const invented = panel({ id: "u1", kind: "escalation_kind_nobody_invented_yet" });
    const pulse = panel({ id: "u2", kind: "pulse" });
    const scoredInvented = scorePanel(invented, DEFAULT_IMPORTANCE_WEIGHTS, NOW);
    expect(scoredInvented.score).toBeGreaterThan(0);
    expect(scoredInvented.because.join(" ")).toContain("escalation_kind_nobody_invented_yet");
    expect(scoredInvented.because.join(" ")).toContain("neutral");
    const ranked = rankPanels([pulse, invented], DEFAULT_IMPORTANCE_WEIGHTS, NOW);
    expect(ranked[0].panel.id).toBe("u1");
  });

  test("the neutral is the MEAN of the known weights — not 0, which would bury it", () => {
    // This is the assertion that kills a "score unknown kinds at 0" patch: it
    // would still outrank `pulse` above (via the unanswered boost) while sitting
    // below every other solicitation. Here the unknown kind must land strictly
    // BETWEEN two known solicitation kinds — only a neutral drawn from the
    // weights themselves can do that.
    const weights: ImportanceWeights = {
      ...DEFAULT_IMPORTANCE_WEIGHTS,
      byKind: { question: 2, gap_needs_human: 8 },
    };
    const ranked = rankPanels(
      [
        panel({ id: "n-low", kind: "question" }),
        panel({ id: "n-unknown", kind: "kind_from_the_future" }),
        panel({ id: "n-high", kind: "gap_needs_human" }),
      ],
      weights,
      NOW,
    );
    expect(ranked.map(s => s.panel.id)).toEqual(["n-high", "n-unknown", "n-low"]);
    // And exactly the mean, not merely "somewhere between".
    const [high, unknown, low] = ranked;
    expect(unknown.score).toBeCloseTo((high.score + low.score) / 2, 10);
  });

  test("an unknown kind still outranks the weakest KNOWN solicitation under the defaults", () => {
    // Both get the unanswered boost, so the comparison isolates the kind term.
    const ranked = rankPanels(
      [
        panel({ id: "d-known-weak", kind: "gap_pending_verification" }),
        panel({ id: "d-unknown", kind: "another_unheard_of_kind" }),
      ],
      DEFAULT_IMPORTANCE_WEIGHTS,
      NOW,
    );
    expect(ranked.map(s => s.panel.id)).toEqual(["d-unknown", "d-known-weak"]);
  });

  test("an importance value absent from the map is neutral, never NaN", () => {
    // The importance vocabulary is as open as the kind vocabulary: the live
    // corpus is 240 "high" / 10 "medium", and nothing stops "critical".
    const scored = scorePanel(panel({ id: "u3", importance: "critical" }), DEFAULT_IMPORTANCE_WEIGHTS, NOW);
    expect(Number.isFinite(scored.score)).toBe(true);
    expect(scored.because.join(" ")).toContain("critical");
    expect(scored.because.join(" ")).toContain("neutral");
  });

  test("an unknown importance scores at the MEAN of the declared weights, not 0", () => {
    const weights: ImportanceWeights = {
      byKind: {},
      agePerDay: 0,
      declaredImportance: { low: 0, high: 10 },
      unansweredBoost: 0,
    };
    const unknown = scorePanel(panel({ id: "imp-unknown", importance: "critical" }), weights, NOW);
    const low = scorePanel(panel({ id: "imp-low", importance: "low" }), weights, NOW);
    const high = scorePanel(panel({ id: "imp-high", importance: "high" }), weights, NOW);
    expect(low.score).toBe(0);
    expect(high.score).toBe(10);
    expect(unknown.score).toBeCloseTo(5, 10);
  });
});

describe("age is a factor, not a sort (requirement 4)", () => {
  test("an old ANSWERED escalation ranks below a fresh UNANSWERED question", () => {
    // 22 days is the top of the observed live age range (97 of 250 live
    // solicitations sit at 22 days); this pins the default calibration.
    const old = panel({ id: "old", kind: "gap_needs_human", createdAt: NOW - 22 * DAY, answered: true });
    const fresh = panel({ id: "new", kind: "question", createdAt: NOW });
    const ranked = rankPanels([old, fresh], DEFAULT_IMPORTANCE_WEIGHTS, NOW);
    expect(ranked.map(s => s.panel.id)).toEqual(["new", "old"]);
  });

  test("among unanswered items age still discriminates", () => {
    const older = panel({ id: "s-older", createdAt: NOW - 22 * DAY });
    const newer = panel({ id: "s-newer", createdAt: NOW - 1 * DAY });
    const ranked = rankPanels([newer, older], DEFAULT_IMPORTANCE_WEIGHTS, NOW);
    expect(ranked.map(s => s.panel.id)).toEqual(["s-older", "s-newer"]);
  });

  test("a createdAt in the future clamps to zero age instead of scoring negative", () => {
    const skewed = scorePanel(panel({ id: "skew", createdAt: NOW + 5 * DAY }), DEFAULT_IMPORTANCE_WEIGHTS, NOW);
    const present = scorePanel(panel({ id: "pres", createdAt: NOW }), DEFAULT_IMPORTANCE_WEIGHTS, NOW);
    expect(skewed.score).toBe(present.score);
    expect(skewed.because.join(" ")).not.toContain("waiting");
  });

  test("the live kind distribution ranks escalations above verification chores", () => {
    // Shape of the real corpus: gap_needs_human 236, gap_pending_verification
    // 101, gap_needs_localization 65, info 19, gap_reland_needs_human 14,
    // question 11, code_change 3, pulse 1 — all unanswered, same age.
    const kinds = [
      "gap_needs_human", "gap_pending_verification", "gap_needs_localization",
      "info", "gap_reland_needs_human", "question", "code_change", "pulse",
    ];
    const ranked = rankPanels(
      kinds.map((kind, i) => panel({ id: `k${i}`, kind })),
      DEFAULT_IMPORTANCE_WEIGHTS,
      NOW,
    );
    const order = ranked.map(s => s.panel.kind);
    expect(order.indexOf("gap_needs_human")).toBeLessThan(order.indexOf("gap_pending_verification"));
    expect(order.indexOf("gap_reland_needs_human")).toBeLessThan(order.indexOf("gap_needs_localization"));
    // Informational panels are not solicitations and must not outrank one.
    for (const kind of ["info", "pulse"]) {
      expect(isSolicitation({ kind })).toBe(false);
      expect(order.indexOf(kind)).toBeGreaterThan(order.indexOf("gap_needs_human"));
    }
  });
});

describe("informational panels are not solicitations (requirement 5)", () => {
  test("an informational panel receives no unanswered boost, and says why", () => {
    const info = scorePanel(panel({ id: "i1", kind: "info" }), DEFAULT_IMPORTANCE_WEIGHTS, NOW);
    expect(info.because.join(" ")).toContain("nothing is being asked");
    expect(info.because.join(" ")).not.toContain("no answer recorded");
    // Same kind weight, but the solicitation gets the boost: the gap between an
    // info panel and a solicitation of equal kind weight is exactly the boost.
    const weights: ImportanceWeights = {
      ...DEFAULT_IMPORTANCE_WEIGHTS,
      byKind: { info: 5, question: 5 },
      declaredImportance: { high: 0 },
    };
    const infoEqual = scorePanel(panel({ id: "i2", kind: "info" }), weights, NOW);
    const asked = scorePanel(panel({ id: "i3", kind: "question" }), weights, NOW);
    expect(asked.score - infoEqual.score).toBeCloseTo(weights.unansweredBoost, 10);
  });

  test("the predicate is store.ts's, so an informational kind added there needs no change here", () => {
    // If store.ts's INFORMATIONAL_KINDS ever changes, this assertion moves with
    // it — which is the point of not re-deriving the kind list.
    const infoKinds = ["info", "pulse"].filter(kind => !isSolicitation({ kind }));
    for (const kind of infoKinds) {
      expect(scorePanel(panel({ id: `pred-${kind}`, kind }), DEFAULT_IMPORTANCE_WEIGHTS, NOW)
        .because.join(" ")).toContain("nothing is being asked");
    }
  });
});

describe("weights are data (requirement 6)", () => {
  test("inverting byKind inverts the order", () => {
    const panels = [
      panel({ id: "w1", kind: "gap_needs_human" }),
      panel({ id: "w2", kind: "question" }),
      panel({ id: "w3", kind: "code_change" }),
    ];
    const forward = rankPanels(panels, DEFAULT_IMPORTANCE_WEIGHTS, NOW).map(s => s.panel.id);
    const inverted: ImportanceWeights = {
      ...DEFAULT_IMPORTANCE_WEIGHTS,
      byKind: Object.fromEntries(
        Object.entries(DEFAULT_IMPORTANCE_WEIGHTS.byKind).map(([kind, w]) => [kind, -w]),
      ),
    };
    const backward = rankPanels(panels, inverted, NOW).map(s => s.panel.id);
    expect(forward).not.toEqual(backward);
    expect(backward).toEqual([...forward].reverse());
  });

  test("weights the scorer has never seen work, including a learner's arbitrary kinds", () => {
    const learned: ImportanceWeights = {
      byKind: { freshly_learned_kind: 100, gap_needs_human: 1 },
      agePerDay: 0,
      declaredImportance: {},
      unansweredBoost: 0,
    };
    const ranked = rankPanels(
      [panel({ id: "L1", kind: "gap_needs_human" }), panel({ id: "L2", kind: "freshly_learned_kind" })],
      learned,
      NOW,
    );
    expect(ranked.map(s => s.panel.id)).toEqual(["L2", "L1"]);
  });

  test("inverting agePerDay puts the newest first", () => {
    const weights: ImportanceWeights = { byKind: {}, agePerDay: -1, declaredImportance: {}, unansweredBoost: 0 };
    const ranked = rankPanels(
      [panel({ id: "a-old", createdAt: NOW - 10 * DAY }), panel({ id: "b-new", createdAt: NOW })],
      weights,
      NOW,
    );
    expect(ranked.map(s => s.panel.id)).toEqual(["b-new", "a-old"]);
  });
});

describe("degenerate weights must not crash or NaN (requirement 7)", () => {
  const zeroed: ImportanceWeights = {
    byKind: {},
    agePerDay: 0,
    declaredImportance: {},
    unansweredBoost: 0,
  };

  test("an all-zero weight set scores every panel finitely and keeps every panel", () => {
    const panels = [
      panel({ id: "z1", createdAt: NOW - 22 * DAY }),
      panel({ id: "z2", kind: "made_up", importance: "made_up_too" }),
      panel({ id: "z3", kind: "info", answered: true }),
    ];
    const ranked = rankPanels(panels, zeroed, NOW);
    expect(ranked).toHaveLength(3);
    for (const s of ranked) {
      expect(Number.isFinite(s.score)).toBe(true);
      expect(s.score).toBe(0);
      expect(s.because.length).toBeGreaterThan(0);
    }
    // Total order still stable under a total tie.
    expect(ranked.map(s => s.panel.id)).toEqual(["z1", "z2", "z3"]);
  });

  test("non-finite weights are treated as zero rather than poisoning the score", () => {
    const poisoned = {
      byKind: { gap_needs_human: Number.NaN },
      agePerDay: Number.POSITIVE_INFINITY,
      declaredImportance: { high: Number.NaN },
      unansweredBoost: 7,
    } as ImportanceWeights;
    const scored = scorePanel(panel({ id: "nan1", createdAt: NOW - DAY }), poisoned, NOW);
    expect(Number.isFinite(scored.score)).toBe(true);
    expect(scored.score).toBe(7);
  });

  test("an empty panel list ranks to an empty list", () => {
    expect(rankPanels([], DEFAULT_IMPORTANCE_WEIGHTS, NOW)).toEqual([]);
  });
});

describe("explainRanking is honest about what is hidden", () => {
  test("with a slice size it states the hidden count", () => {
    const panels = Array.from({ length: 425 }, (_, i) =>
      panel({ id: `e${String(i).padStart(3, "0")}`, createdAt: NOW - (i % 23) * DAY }));
    const ranked = rankPanels(panels, DEFAULT_IMPORTANCE_WEIGHTS, NOW);
    const line = explainRanking(ranked, 5);
    expect(line).toContain("5");
    expect(line).toContain("425");
    expect(line).toContain("420");
    expect(line.split("\n")).toHaveLength(1);
  });

  test("without a slice size it claims nothing about hiding", () => {
    const ranked = rankPanels([panel({ id: "x1" }), panel({ id: "x2" })], DEFAULT_IMPORTANCE_WEIGHTS, NOW);
    const line = explainRanking(ranked);
    expect(line).toContain("2");
    expect(line).not.toContain("not shown");
  });

  test("a slice at least as large as the list reports nothing hidden", () => {
    const ranked = rankPanels([panel({ id: "y1" }), panel({ id: "y2" })], DEFAULT_IMPORTANCE_WEIGHTS, NOW);
    expect(explainRanking(ranked, 9)).not.toContain("not shown");
  });

  test("an empty ranking says so instead of describing a top item", () => {
    expect(explainRanking([], 5).toLowerCase()).toContain("nothing");
  });

  test("the summary names the top item's leading reason, so a human can disagree with it", () => {
    const ranked = rankPanels(
      [panel({ id: "top", createdAt: NOW - 22 * DAY }), panel({ id: "low", kind: "pulse" })],
      DEFAULT_IMPORTANCE_WEIGHTS,
      NOW,
    );
    const line = explainRanking(ranked, 1);
    expect(line).toContain(ranked[0].because[0]);
  });
});
