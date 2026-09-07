import { type UseQueryResult } from "@tanstack/react-query";
import type { RenderPolicy } from "./client";
import type { ActiveDispatch, GoalWalkState } from "./types";
export declare const queryKeys: {
    board: readonly ["activeDispatches"];
    walk: (dispatchId: string) => readonly ["goalWalkState", string];
    shapes: readonly ["fleetShapes"];
    capability: (shape: string) => readonly ["vesselCapability", string];
    renderPolicy: readonly ["renderPolicy"];
};
/**
 * The board.
 *
 * `enabled` is how rule P6's freeze is implemented, and the choice matters:
 * with `enabled: false` TanStack Query stops refetching but KEEPS the cached
 * data, so a frozen region shows the last state it had rather than blanking.
 * Unmounting the query, or clearing it, would discard state the reader is in
 * the middle of reading — which is the same failure as moving the row.
 */
export declare function useBoard(opts: {
    enabled: boolean;
    intervalMs: number;
}): UseQueryResult<readonly ActiveDispatch[]>;
export declare function useWalk(dispatchId: string | null, opts: {
    enabled: boolean;
    intervalMs: number;
}): UseQueryResult<GoalWalkState>;
/**
 * The live shape vocabulary. Long stale time: the fleet's vocabulary changes on
 * the order of deployments, not seconds, and re-deriving starters underneath a
 * reader who is about to click one would move the target.
 */
export declare function useFleetShapes(): UseQueryResult<readonly string[]>;
/** Producer verification for ONE starter. Refines a chip already on screen. */
export declare function useCapability(shape: string, enabled: boolean): UseQueryResult<boolean>;
export declare function useDispatchGoal(): any;
export declare function useSubmitGrade(): any;
export declare function useAnswerSolicitation(): any;
export declare function useInjectContext(): any;
/**
 * Rendering behaviour, re-read on the live cadence. Freezes with everything
 * else when the reader pauses — a policy change must not move the surface under
 * someone who has deliberately stopped it.
 */
export declare function useRenderPolicy(opts: {
    enabled: boolean;
    intervalMs: number;
}): UseQueryResult<RenderPolicy>;
//# sourceMappingURL=queries.d.ts.map