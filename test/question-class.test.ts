/**
 * Only asks lead the rail and count as waiting. Shapes are the ones 18310
 * served on 2026-10-10: templated gap asks, scope notices, empty code_change
 * and "Untitled" panels, and a panel whose writer never rendered its template.
 */
import { describe, expect, test } from "bun:test";
import type { Question } from "../ui/src/api/participation";
import { bodyLead, classifyQuestion } from "../ui/src/lib/questionClass";
import { gapTitle, groupQuestions, questionSubject, waitingCount } from "../ui/src/state/questions";

function q(id: string, kind: string, body: unknown, extra: Partial<Question> = {}): Question {
  return { id, revision: 1, title: "t", body, createdAt: 0, updatedAt: 0, responses: [], answered: false, declined: false, kind, ...extra };
}

const escalation = q("needs-human-reach-gap-docs-align-tick", "gap_needs_human", "Gap reach-gap-docs-align-tick (unreachable_producer) has failed auto-repair 8+ times. Summary: Reachability gap: shape");
const reland = q("reland-needs-human-route-edit-03902f38", "gap_reland_needs_human", "Gap route-edit-03902f38 (edit_intent_route) has had multiple landings. Summary: In repos/x");
const verify = q("pending-verify-route-edit-e8797240", "gap_pending_verification", "Gap route-edit-e8797240 (edit_intent_route) had a single landing. Please confirm. Summary: In repos/development-vessel/src/resolvers/feature-compose.ts, add a FABRICATE");
const localize = q("needs-localization-db_performance_slow_queries_2026-10-01T06", "gap_needs_localization", "Localization failed for gap db_performance_slow_queries_2026-10-01T06: name the file. Summary: Slow queries");
const notice = q("scope-change-13e454928d59f1b7", "notice", "tighten of repos/goal-host-vessel/src/goal-target-inference.ts by scope_earn_in_apply");
const emptyChange = q("panel-1790780120573", "code_change", "", { title: "Remove 'continue' statement in pickMostLandable", asks: [] });
const untitled = q("panel-1790780094241", "question", "", { title: "Untitled" });
const template = q("{{goal.id}}", "{{goal.kind}}", "How are you?", { title: "{{goal.title}}" });
const withAsks = q("93b051b4-4364-4a9e-b970-4b5b4e7a9c38", "question", "", { title: "Revised", asks: [{ id: "cause", prompt: "Cause?", type: "text" }] });

describe("classifyQuestion", () => {
  test("gap escalations, which a reader applies, are asks", () => {
    expect(classifyQuestion(escalation)).toBe("ask");
    expect(classifyQuestion(reland)).toBe("ask");
  });

  test("a question with parts to answer is an ask even with an empty body", () => {
    expect(classifyQuestion(withAsks)).toBe("ask");
  });

  test("must-fail: kinds no reader takes, notices, and malformed panels are not asks", () => {
    expect(classifyQuestion(verify)).toBe("unread");
    expect(classifyQuestion(localize)).toBe("unread");
    expect(classifyQuestion(notice)).toBe("notice");
    expect(classifyQuestion(emptyChange)).toBe("malformed");
    expect(classifyQuestion(untitled)).toBe("malformed");
    expect(classifyQuestion(template)).toBe("malformed");
  });
});

describe("the rail", () => {
  const all = [notice, verify, escalation, template, reland, untitled, localize, emptyChange, withAsks];

  test("asks lead, open; then Notices, No reader, Malformed, folded", () => {
    const groups = groupQuestions(all);
    expect(groups.filter((g) => !g.folded).flatMap((g) => g.questions.map((x) => x.id))).toEqual([
      escalation.id,
      reland.id,
      withAsks.id,
    ]);
    expect(groups.filter((g) => g.folded).map((g) => [g.label, g.questions.length])).toEqual([
      ["Notices", 1],
      ["No reader", 2],
      ["Malformed", 3],
    ]);
  });

  test("must-fail: only open asks count as waiting", () => {
    expect(waitingCount(all)).toBe(3);
    expect(waitingCount([...all, { ...escalation, id: "needs-human-x", answered: true }])).toBe(3);
  });
});

describe("bodyLead", () => {
  test("drops the writer's truncated Summary clause, keeps the ask", () => {
    expect(bodyLead(verify)).toBe("Gap route-edit-e8797240 (edit_intent_route) had a single landing. Please confirm.");
    expect(bodyLead(notice)).toBe(notice.body as string);
  });
});

describe("question titles", () => {
  test("a gap id that is a phrase titles its question, not the agent-written summary", () => {
    const q2 = q("needs-human-cold-boot-silently-skips-twenty-two-unparseable-migration-files", "gap_needs_human",
      "Gap cold-boot-silently-skips-twenty-two-unparseable-migration-files (x) failed. Summary: REOPENED 2026-09-22. This gap was CLOSED WITHOUT ITS FIX");
    expect(questionSubject(q2)).toBe("Cold boot silently skips twenty two unparseable migration files");
  });

  test("must-fail: an id that is not a phrase keeps the summary", () => {
    expect(gapTitle("route-edit-03902f38")).toBeNull();
    expect(gapTitle("reach-gap-docs")).toBeNull();
    // Dated parts drop; the phrase left still titles it.
    expect(gapTitle("db_performance_slow_queries_2026-10-01T06")).toBe("Db performance slow queries");
    expect(questionSubject(reland)).toBe("In repos/x");
  });

  test("a question with no gap keeps its title", () => {
    expect(questionSubject(withAsks)).toBe("Revised");
  });
});
