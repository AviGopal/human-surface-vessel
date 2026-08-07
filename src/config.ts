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

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

export const PORT = envInt("PORT", 8310);
export const HOST = process.env.HOST ?? "0.0.0.0";

export const VESSEL_ID =
  process.env.HUMAN_SURFACE_VESSEL_ID ?? process.env.VESSEL_ID ?? "human-surface-vessel";
export const VESSEL_NAME = "human-surface-vessel";

/**
 * The Makefile/gen-env thread DISCOVERY_ENDPOINT through to every unit; some
 * older units are handed DISCOVERY_VESSEL_ENDPOINT instead. Read both so the
 * vessel registers whichever name its unit file carries.
 */
export const DISCOVERY_ENDPOINT =
  process.env.DISCOVERY_ENDPOINT ??
  process.env.DISCOVERY_VESSEL_ENDPOINT ??
  "http://127.0.0.1:8100";

/**
 * Last-resort fallback for goal-host. The proxy resolves goal-host THROUGH
 * discovery by shape first; this env (and the literal after it) exist only so
 * a discovery outage degrades instead of failing hard. A peer address is never
 * the only path to a peer.
 */
export const GOAL_HOST_ENDPOINT =
  process.env.GOAL_HOST_ENDPOINT ?? "http://127.0.0.1:8210";

export const METABOB_API_KEY =
  process.env.HUMAN_SURFACE_VESSEL_API_KEY ?? process.env.METABOB_API_KEY ?? "";

/**
 * The shape vocabulary this vessel serves. INHERITED from stateful-ui-vessel,
 * which this vessel replaces — retiring that vessel must not retire its
 * vocabulary.
 *
 * HARD INVARIANT: this array and the `switch (pointer.type)` in
 * `src/routes/impulses.ts` must agree exactly. The switch imports this array
 * and reports it verbatim in its 400 body, so the two cannot drift silently.
 */
export const DISCOVERY_SHAPES = [
  "uiPanel_write",
  "uiQuestion_write",
  "uiFeedback",
  "interactorObservation",
  "interactorEvent",
  "interactorAssertion",
  "interactorAttachment",
  // Rendering is a BEHAVIOUR, so it must be steered by a shaped impulse read at
  // use time — not by a switch compiled into the bundle. `renderPolicy` is that
  // impulse: the surface reads it every poll and lets it override the built-in
  // form heuristic, which is demoted from a decision to a prior.
  "renderPolicy",
  "renderPolicy_write",
  // Prose from a human, parsed into a `renderPolicy` patch. Advertised as its
  // own shape rather than hidden behind `renderPolicy_write` because the two
  // consume different things: one takes a policy patch a machine already knows
  // how to build, the other takes a sentence and OWNS the decomposition — which
  // is the whole point of a human surface (a person sends language; the system
  // does the translation, not the person).
  "surfaceIntent",
] as const;

export type DiscoveryShape = (typeof DISCOVERY_SHAPES)[number];

/** Loopback-safe self endpoint used in the registration payload. */
export const SELF_ENDPOINT = `http://127.0.0.1:${PORT}`;
export const RESOLVE_PATH = "/v2/impulses/resolve";

export const config = Object.freeze({
  PORT,
  HOST,
  VESSEL_ID,
  VESSEL_NAME,
  DISCOVERY_ENDPOINT,
  GOAL_HOST_ENDPOINT,
  SELF_ENDPOINT,
  RESOLVE_PATH,
  DISCOVERY_SHAPES,
});

export default config;
