/**
 * A run as the chain of impulses it produced — what fed what — rather than a
 * timeline of events and log lines.
 *
 * Built only from fields goal-host serves on `goalWalkState` since slice V4:
 * each pool entry's `id`, its real `producedBy`, `producerExecutionId` and the
 * `consumedIds` it was actually bound to. No log line is parsed and no shape
 * name is special-cased.
 *
 * Which entry leads: there is no answer role on an impulse yet (coordinator ask
 * C6), so the rule is structural — an output that consumed other outputs and
 * that nothing else consumed is a terminal derivation. Those lead, largest
 * first. Everything else a step produced and nothing consumed is listed as
 * produced-but-unused. Seeds are the request, not output.
 *
 * Since slice V8 retries and re-frames continue from the built pool, so the
 * chain is the run's, not one attempt's.
 */

import type { GoalWalkState, RawProvenance } from "../api/types";

export interface ChainNode {
  readonly id: string;
  readonly shape: string;
  readonly producedBy: string | null;
  readonly producerExecutionId: string | null;
  readonly consumedIds: readonly string[];
  readonly chars: number;
  readonly raw: RawProvenance;
}

export interface RunChains {
  /** Terminal derivations: consumed something, consumed by nothing. Largest first. */
  readonly outputs: readonly ChainNode[];
  /** Produced by a step, consumed by nothing, consuming nothing. */
  readonly unused: readonly ChainNode[];
  /** Every node by id, seeds included, for resolving `consumedIds`. */
  readonly byId: ReadonlyMap<string, ChainNode>;
  /** The record carries pool entries at all (false once the server has blanked it). */
  readonly retained: boolean;
  /** Entries carry ids and edges (records written before V4 do not). */
  readonly edgesRecorded: boolean;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function node(raw: RawProvenance, index: number): ChainNode | null {
  const shape = str(raw.shape);
  if (!shape) return null;
  const r = raw as RawProvenance & { id?: unknown; producerExecutionId?: unknown; consumedIds?: unknown };
  const consumed = Array.isArray(r.consumedIds) ? r.consumedIds.filter((x): x is string => typeof x === "string") : [];
  return {
    // Records written before V4 carry no id; position keeps them distinct.
    id: str(r.id) ?? `#${index}:${shape}`,
    shape,
    producedBy: str(raw.producedBy),
    producerExecutionId: str(r.producerExecutionId),
    consumedIds: consumed,
    chars: typeof raw.chars === "number" && Number.isFinite(raw.chars) ? raw.chars : 0,
    raw,
  };
}

export function isSeed(n: ChainNode): boolean {
  return n.producedBy === "seed";
}

/**
 * Shapes the walk seeded from the request. Records since V4 mark them
 * `producedBy: "seed"`; older ones only show it on the pool events
 * (`seed var <name>`, plus the goal itself).
 */
function seededShapes(walk: GoalWalkState): ReadonlySet<string> {
  return new Set(
    walk.poolEvents
      .filter((e) => e.shape === "goal" || (typeof e.source === "string" && e.source.startsWith("seed var ")))
      .map((e) => e.shape)
      .filter((s): s is string => typeof s === "string"),
  );
}

export function buildChains(walk: GoalWalkState): RunChains {
  const nodes = walk.poolProvenance.map(node).filter((n): n is ChainNode => n !== null);
  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  const consumedSomewhere = new Set(nodes.flatMap((n) => n.consumedIds));
  const seeded = seededShapes(walk);
  // Before V4 every entry said "goal-host-walk", so a seeded shape is the request.
  const fromRequest = (n: ChainNode): boolean =>
    isSeed(n) || (n.producedBy === "goal-host-walk" && seeded.has(n.shape));
  const produced = nodes.filter((n) => !fromRequest(n));
  const outputs = produced
    .filter((n) => n.consumedIds.length > 0 && !consumedSomewhere.has(n.id))
    .sort((a, b) => b.chars - a.chars);
  const unused = produced.filter((n) => n.consumedIds.length === 0 && !consumedSomewhere.has(n.id));
  const edgesRecorded = walk.poolProvenance.some((p) => "consumedIds" in (p as object));
  return { outputs, unused, byId, retained: walk.poolProvenance.length > 0, edgesRecorded };
}

/** The inputs a node was bound to, resolved; ids the record no longer holds are returned separately. */
export function inputsOf(n: ChainNode, chains: RunChains): { inputs: readonly ChainNode[]; missing: readonly string[] } {
  const inputs: ChainNode[] = [];
  const missing: string[] = [];
  for (const id of n.consumedIds) {
    const hit = chains.byId.get(id);
    if (hit) inputs.push(hit);
    else missing.push(id);
  }
  return { inputs, missing };
}
