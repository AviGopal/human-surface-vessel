/**
 * Discovery registration.
 *
 * THE FLAT-PAYLOAD TRAP: discovery-vessel's `RegistryStore.register` reads the
 * resolve contract fields (`resolve_endpoint`, `resolve_request_format`,
 * `auth_scheme`, `resolve_timeout_ms`) ONLY from the TOP LEVEL of the request
 * body. A nested `resolverContract: {...}` survives as dead metadata while the
 * record silently takes defaults — that is why metric-collector-vessel is
 * invisible. Every contract field below is flat.
 *
 * `systemVessel: true` is equally load-bearing: without it the record is
 * filtered out of org-scoped queries (registry.ts checks
 * `vessel.systemVessel === true || vessel.orgId === orgId`).
 *
 * Re-registration IS the heartbeat: the registry TTL is 5 minutes, so we
 * re-POST /register every 60s. Registration is non-blocking and non-fatal —
 * every error is swallowed and the interval is `.unref()`ed, so a discovery
 * outage never stops this vessel from serving.
 */
/** FLAT. Do not nest the contract fields — see the module comment. */
export declare const REGISTRATION_PAYLOAD: {
    readonly vesselId: string;
    readonly name: "human-surface-vessel";
    readonly endpoint: string;
    readonly shapes: readonly ["uiPanel_write", "uiQuestion_write", "uiFeedback", "interactorObservation", "interactorEvent", "interactorAssertion", "interactorAttachment", "renderPolicy", "renderPolicy_write", "surfaceIntent"];
    readonly resolve_endpoint: `${string}/v2/impulses/resolve`;
    readonly resolve_request_format: "pointer";
    readonly auth_scheme: "ApiKey";
    readonly resolve_timeout_ms: 10000;
    readonly port: number;
    readonly systemVessel: true;
};
export declare function registerWithDiscovery(): Promise<void>;
/** Fire-and-forget. Never awaited by startup, never throws. */
export declare function startDiscoveryRegistration(): void;
export declare function stopDiscoveryRegistration(): void;
/** Best-effort withdrawal on SIGTERM. Swallows everything. */
export declare function deregisterFromDiscovery(): Promise<void>;
export interface DiscoveryStatus {
    endpoint: string;
    status: "never" | "ok" | "failed";
    last_attempt_at: number | null;
    last_error: string | null;
}
/**
 * Reported in the /health body for legibility. Health NEVER fails on a
 * discovery outage — the vessel is serving whether or not discovery answers.
 */
export declare function discoveryStatus(): DiscoveryStatus;
//# sourceMappingURL=discovery-registration.d.ts.map