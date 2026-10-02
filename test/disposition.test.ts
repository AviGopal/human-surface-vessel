/**
 * Escalation answers are built to the contract of the reader that applies them
 * (development-vessel escalation_disposition_apply). These tests pin:
 *
 *  - the surface's parseDisposition is byte-identical to the reader's;
 *  - every answer the widget lets a person send parses to the verb they chose;
 *  - answers that would flip to another verb are refused before sending;
 *  - the outcome read back from the gap distinguishes applied / replaced / waiting;
 *  - a filed complaint returns the id of the issue it becomes.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import {
  DISPOSITIONS,
  answerReaderFor,
  answersAreUnread,
  appliedDisposition,
  buildEscalationAnswer,
  checkEscalationAnswer,
  gapIdForPanel,
  outcomeOf,
  parseDisposition,
  type DispositionVerb,
} from "../ui/src/lib/disposition";
import { feedbackGapId, impulsesRouter } from "../src/routes/impulses.ts";

const READER = new URL("../../development-vessel/src/resolvers/escalation-disposition-apply.ts", import.meta.url).pathname;
const MIRROR = new URL("../ui/src/lib/disposition.ts", import.meta.url).pathname;
const IN_SUPER_REPO = existsSync(new URL("../../../openspec", import.meta.url).pathname);

function functionText(file: string): string {
  const m = /export function parseDisposition\(answer: string\): DispositionVerb \| null \{[\s\S]*?\n\}/.exec(readFileSync(file, "utf8"));
  if (!m) throw new Error(`parseDisposition not found in ${file}`);
  return m[0];
}

describe("parser mirror", () => {
  // In a checkout that has the reader, the mirror MUST be compared; a missing
  // reader there is a moved file, and skipping would read as a pass.
  test("the reader's source is present when running inside the super-repo", () => {
    if (IN_SUPER_REPO) expect(existsSync(READER)).toBe(true);
  });

  test.skipIf(!existsSync(READER))("parseDisposition is byte-identical to development-vessel's", () => {
    expect(functionText(MIRROR)).toBe(functionText(READER));
  });

  test("the reader's parse order: redefine, grant access, provide information, drop — anywhere in the text", () => {
    expect(parseDisposition("drop it, no need to redefine anything")).toBe("redefine");
    expect(parseDisposition("provide missing information: the credential is in vault")).toBe("grant_access");
    expect(parseDisposition("It should search the web thoroughly")).toBeNull();
    expect(parseDisposition("We will need to create a clone for it to use.")).toBeNull();
  });
});

describe("escalation answers the widget can send", () => {
  const details = [
    "",
    "It should route to web_search — the tool is advertised and answers in one call.",
    "The spool is an intermediary to the trace store.",
    "not worth it; superseded by the realignment work",
  ];

  test("every verb × clean detail parses to the chosen verb", () => {
    for (const { verb } of DISPOSITIONS) {
      for (const d of details) {
        const a = { verb, details: d };
        const problem = checkEscalationAnswer(a);
        if (problem === null) expect(parseDisposition(buildEscalationAnswer(a))).toBe(verb);
      }
    }
  });

  test("details that the reader would read as another verb are refused", () => {
    const flip = checkEscalationAnswer({ verb: "drop", details: "no need to redefine anything, just drop it" });
    expect(flip).toEqual({ kind: "verb_flip", readAs: "redefine" });
    const credential = checkEscalationAnswer({ verb: "provide_information", details: "the credential lives in the vault" });
    expect(credential).toEqual({ kind: "verb_flip", readAs: "grant_access" });
  });

  test("labelled fields use the reader's line format and rules", () => {
    const text = buildEscalationAnswer({
      verb: "provide_information",
      details: "route to web_search",
      editSite: "repos/goal-host-vessel/src/goal-intent.ts",
      verifyShape: "web_search",
    });
    expect(text).toBe("provide missing information\nroute to web_search\nEDIT_SITE: repos/goal-host-vessel/src/goal-intent.ts\nVERIFY_SHAPE: web_search");
    expect(checkEscalationAnswer({ verb: "drop", details: "", editSite: "src/x.ts" })?.kind).toBe("edit_site");
    expect(checkEscalationAnswer({ verb: "drop", details: "", editSite: "repos/a/../b.ts" })?.kind).toBe("edit_site");
    expect(checkEscalationAnswer({ verb: "drop", details: "", verifyShape: "web search" })?.kind).toBe("verify_shape");
  });
});

describe("which reader answers go to", () => {
  test("panel id prefixes map to their readers, and unread kinds are marked", () => {
    expect(answerReaderFor("needs-human-x")).toBe("escalation");
    expect(answerReaderFor("reland-needs-human-x")).toBe("escalation");
    expect(answerReaderFor("pending-verify-x")).toBe("pending_verification");
    expect(answerReaderFor("needs-localization-x")).toBe("localization");
    expect(answerReaderFor("docs-decision-x")).toBe("docs_decision");
    expect(answersAreUnread("escalation")).toBe(false);
    expect(answersAreUnread("pending_verification")).toBe(true);
    expect(gapIdForPanel("reland-needs-human-abc")).toBe("abc");
    expect(gapIdForPanel("needs-human-abc")).toBe("abc");
    expect(gapIdForPanel("pending-verify-abc")).toBeNull();
  });
});

describe("outcome read back from the gap", () => {
  const sentAt = Date.parse("2026-09-30T14:00:00Z");
  const gap = (meta: Record<string, unknown>, status = "open") => appliedDisposition({ status, classification_metadata: meta });

  test("applied when the gap records this answer's id", () => {
    const o = outcomeOf("r1", sentAt, gap({ human_disposition: "drop", human_disposition_record_id: "r1", human_disposition_at: "2026-09-30T14:05:00Z" }, "closed"));
    expect(o.kind).toBe("applied");
  });

  test("superseded when a different answer was applied after this one was sent", () => {
    const o = outcomeOf("r1", sentAt, gap({ human_disposition: "redefine", human_disposition_record_id: "r2", human_disposition_at: "2026-09-30T14:10:00Z" }));
    expect(o.kind).toBe("superseded");
  });

  test("waiting when nothing newer than this answer has been applied", () => {
    expect(outcomeOf("r1", sentAt, gap({})).kind).toBe("waiting");
    const older = gap({ human_disposition: "drop", human_disposition_record_id: "r0", human_disposition_at: "2026-09-29T10:00:00Z" });
    expect(outcomeOf("r1", sentAt, older).kind).toBe("waiting");
  });
});

describe("a filed complaint names its issue", () => {
  test("feedbackGapId keys complaints the way the legibility detector does", () => {
    expect(feedbackGapId("the surface", "wrong")).toBe("ui-feedback-the-surface-wrong");
    expect(feedbackGapId("needs-human-a/b", "hard_to_see")).toBe("ui-feedback-needs-human-a-b-hard_to_see");
  });

  test("the uiFeedback response carries filed_gap_id for a complaint and not for an answer", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => new Response("{}")) as unknown as typeof fetch;
    try {
      const post = (pointer: Record<string, unknown>) =>
        impulsesRouter.request("/v2/impulses/resolve", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ impulse: { pointer } }),
        });
      const complaint = await (await post({ type: "uiFeedback", panel_id: "the surface", response_id: crypto.randomUUID(), value: "unreadable", kind: "reaction", complaint_kind: "wrong" })).json();
      expect(complaint.body.filed_gap_id).toBe("ui-feedback-the-surface-wrong");
      const plain = await (await post({ type: "uiFeedback", panel_id: "the surface", response_id: crypto.randomUUID(), value: "fine", kind: "reaction" })).json();
      expect(plain.body.filed_gap_id).toBeUndefined();
    } finally {
      globalThis.fetch = original;
    }
  });
});

const verbs: readonly DispositionVerb[] = DISPOSITIONS.map((d) => d.verb);
test("the four decisions are exactly the reader's verbs", () => {
  expect([...verbs].sort()).toEqual(["drop", "grant_access", "provide_information", "redefine"]);
});
