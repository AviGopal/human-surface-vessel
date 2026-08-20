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

import {
  DISCOVERY_ENDPOINT,
  DISCOVERY_SHAPES,
  METABOB_API_KEY,
  PORT,
  RESOLVE_PATH,
  SELF_ENDPOINT,
  VESSEL_ID,
  VESSEL_NAME,
} from "./config.js";

const REREGISTER_INTERVAL_MS = 60_000;

/** FLAT. Do not nest the contract fields — see the module comment. */
export const REGISTRATION_PAYLOAD = {
  vesselId: VESSEL_ID,
  name: VESSEL_NAME,
  endpoint: SELF_ENDPOINT,
  shapes: [...DISCOVERY_SHAPES],
  resolve_endpoint: `${SELF_ENDPOINT}${RESOLVE_PATH}`,
  resolve_request_format: "pointer",
  auth_scheme: "ApiKey",
  resolve_timeout_ms: 10_000,
  port: PORT,
  systemVessel: true,
} as const;

let lastStatus: "never" | "ok" | "failed" = "never";
let lastError: string | null = null;
let lastAttemptAt: number | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

function authHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    ...(METABOB_API_KEY ? { Authorization: `ApiKey ${METABOB_API_KEY}` } : {}),
  };
}

export async function registerWithDiscovery(): Promise<void> {
  lastAttemptAt = Date.now();
  try {
    const res = await fetch(`${DISCOVERY_ENDPOINT}/register`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(REGISTRATION_PAYLOAD),
    });
    if (res.ok) {
      lastStatus = "ok";
      lastError = null;
    } else {
      // Carry discovery's REASON, not just its status. Re-registration is the
      // heartbeat and the registry TTL is 5 minutes, so a sustained failure
      // here drops this vessel out of the registry entirely — measured
      // 2026-08-19, 37 minutes of bare `discovery register failed: 401` that
      // said nothing about whether the key was revoked or identity was
      // unreachable. Discovery now answers with `error.reason` /
      // `error.detail`; surface them or the operator is back to guessing.
      //
      // Tolerant by construction: an older discovery that returns no body, a
      // non-JSON error page, or a proxy's own 502 all degrade to the bare
      // status line this replaced, never to a throw inside the heartbeat.
      const reason = await res
        .json()
        .then((b: unknown) => {
          const e = (b as { error?: { reason?: unknown; detail?: unknown } } | null)?.error;
          const parts = [e?.reason, e?.detail].filter((p): p is string => typeof p === "string");
          return parts.length > 0 ? ` (${parts.join(": ")})` : "";
        })
        .catch(() => "");
      lastStatus = "failed";
      lastError = `register returned ${res.status}${reason}`;
      console.warn(`[human-surface] discovery register failed: ${res.status}${reason}`);
    }
  } catch (err) {
    lastStatus = "failed";
    lastError = err instanceof Error ? err.message : String(err);
    console.warn(`[human-surface] discovery register error: ${lastError}`);
  }
}

/** Fire-and-forget. Never awaited by startup, never throws. */
export function startDiscoveryRegistration(): void {
  void registerWithDiscovery();
  if (timer) return;
  timer = setInterval(() => {
    void registerWithDiscovery();
  }, REREGISTER_INTERVAL_MS);
  // A registration heartbeat must never be the reason the process stays alive.
  if (typeof timer.unref === "function") timer.unref();
}

export function stopDiscoveryRegistration(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

/** Best-effort withdrawal on SIGTERM. Swallows everything. */
export async function deregisterFromDiscovery(): Promise<void> {
  stopDiscoveryRegistration();
  try {
    await fetch(`${DISCOVERY_ENDPOINT}/vessels/${encodeURIComponent(VESSEL_ID)}`, {
      method: "DELETE",
      headers: authHeaders(),
    });
  } catch (err) {
    console.warn(
      `[human-surface] discovery deregister error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

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
export function discoveryStatus(): DiscoveryStatus {
  return {
    endpoint: DISCOVERY_ENDPOINT,
    status: lastStatus,
    last_attempt_at: lastAttemptAt,
    last_error: lastError,
  };
}
