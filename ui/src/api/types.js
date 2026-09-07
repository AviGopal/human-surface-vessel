/**
 * The wire contract, typed against what goal-host ACTUALLY serializes.
 *
 * The important thing in this file is what is OPTIONAL. goal-host's
 * goalWalkState serializer null-coalesces most fields but NOT all of them:
 * `goal`, `executionId`, `selectedTemplateId`, and `error` are written through
 * bare, so `JSON.stringify` drops the key entirely when the value is
 * undefined. Typing those as `string | null` would compile and then lie at
 * runtime — `state.executionId` is `undefined`, not `null`, and every
 * `=== null` guard written against it silently fails open.
 *
 * Same defect, worse consequences, in `poolProvenance`: the empty-content
 * branch omits `contentPreview` and `truncated` rather than emitting `false`.
 * That union is not represented here as an optional field — it is normalized
 * into a discriminated union in `lib/ledger.ts` before any component sees it.
 */
export const EXECUTION_PATH_PROSE = {
    learned_pathway: "ran a pathway it had learned before",
    satisfier: "was satisfied directly, without a full walk",
    universal_tool_fallback: "fell back to the general tool loop",
    feature_compose: "went through the code-editing composer",
    fresh_derivation: "derived a new path from the shape graph",
};
//# sourceMappingURL=types.js.map