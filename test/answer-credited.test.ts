/**
 * Only an output the judge credited stands in for a verdict-only answer.
 * Shape: run 1651d791 (10-17), "What projects are currently popular on
 * github?", reached on webSearchResult (completionShapes), which had been
 * reduced to a placeholder; the first output, a 234,821-character git status
 * of the local repository, was promoted as the answer.
 */
import { describe, expect, test } from "bun:test";
import { answerNode, buildChains } from "../ui/src/lib/chain";

const walk = (completionShapes: string[] | null) => ({
  dispatchId: "d", status: "completed", reached: true, completionShapes, poolEvents: [], walkLog: [], steps: [],
  poolProvenance: [
    { id: "g", shape: "goal", producedBy: "seed", contentPreview: "{\"goal\":\"github\"}", chars: 17, consumedIds: [] },
    { id: "a", shape: "git_status", producedBy: "satisfier:git_status", contentPreview: " M leases/maintenance-autonomous_pick.json\n?? GPT-5.md\n?? substrate-node.zip", chars: 234821, consumedIds: [] },
    { id: "b", shape: "webSearchResult", producedBy: "activity:⟨learned-satisfier-web-search-result⟩", contentPreview: "{\"producedBy\":\"activity:⟨learned-satisfier-web-search-result⟩\",\"executionId\":\"exec_x\"}", chars: 93, consumedIds: [] },
  ],
}) as never;

describe("answer promotion", () => {
  test("must-fail: an uncredited output is never promoted; a credited placeholder promotes nothing", () => {
    expect(answerNode(buildChains(walk(["webSearchResult"])), ["webSearchResult"])).toBeNull();
  });
  test("a credited output with content is promoted", () => {
    const w = walk(["git_status"]);
    expect(answerNode(buildChains(w), ["git_status"])?.shape).toBe("git_status");
  });
  test("with nothing credited, the old rule applies", () => {
    expect(answerNode(buildChains(walk(null)), null)?.shape).toBe("git_status");
  });
});
