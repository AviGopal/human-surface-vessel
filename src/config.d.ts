/**
 * human-surface-vessel — configuration.
 *
 * Bootstrap-only values (law 1): port, host, identity, peer endpoints. Nothing
 * behavioural is gated here — behaviour is steered by shaped impulses read at
 * use time.
 *
 * PORT defaults to this vessel's OWN port, 8310. (8290 belongs to the
 * obsidian-vessel resolver bridge and is reserved; defaulting to another
 * vessel's port is the metric-collector bug and is never done here.)
 */
export declare const PORT: number;
export declare const HOST: string;
export declare const VESSEL_ID: string;
export declare const VESSEL_NAME = "human-surface-vessel";
/**
 * The Makefile/gen-env thread DISCOVERY_ENDPOINT through to every unit; some
 * older units are handed DISCOVERY_VESSEL_ENDPOINT instead. Read both so the
 * vessel registers whichever name its unit file carries.
 */
export declare const DISCOVERY_ENDPOINT: string;
/**
 * Last-resort fallback for goal-host. The proxy resolves goal-host THROUGH
 * discovery by shape first; this env (and the literal after it) exist only so
 * a discovery outage degrades instead of failing hard. A peer address is never
 * the only path to a peer.
 */
export declare const GOAL_HOST_ENDPOINT: string;
export declare const METABOB_API_KEY: string;
/**
 * The shape vocabulary this vessel serves. INHERITED from stateful-ui-vessel,
 * which this vessel replaces — retiring that vessel must not retire its
 * vocabulary.
 *
 * HARD INVARIANT: this array and the `switch (pointer.type)` in
 * `src/routes/impulses.ts` must agree exactly. The switch imports this array
 * and reports it verbatim in its 400 body, so the two cannot drift silently.
 */
export declare const DISCOVERY_SHAPES: readonly ["uiPanel_write", "uiQuestion_write", "uiFeedback", "interactorObservation", "interactorEvent", "interactorAssertion", "interactorAttachment", "renderPolicy", "renderPolicy_write", "surfaceIntent"];
export type DiscoveryShape = (typeof DISCOVERY_SHAPES)[number];
/** Loopback-safe self endpoint used in the registration payload. */
export declare const SELF_ENDPOINT: string;
export declare const RESOLVE_PATH = "/v2/impulses/resolve";
export declare const config: Readonly<{
    PORT: number;
    HOST: string;
    VESSEL_ID: string;
    VESSEL_NAME: "human-surface-vessel";
    DISCOVERY_ENDPOINT: string;
    GOAL_HOST_ENDPOINT: string;
    SELF_ENDPOINT: string;
    RESOLVE_PATH: "/v2/impulses/resolve";
    DISCOVERY_SHAPES: readonly ["uiPanel_write", "uiQuestion_write", "uiFeedback", "interactorObservation", "interactorEvent", "interactorAssertion", "interactorAttachment", "renderPolicy", "renderPolicy_write", "surfaceIntent"];
}>;
export default config;
//# sourceMappingURL=config.d.ts.map