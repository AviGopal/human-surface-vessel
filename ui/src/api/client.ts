/**
 * Every call in this file is same-origin and relative. There is no configurable
 * base URL and no environment variable naming a host, on purpose:
 *
 *  - goal-host has NO CORS and NO inbound auth. A browser cannot call it, and
 *    if it could, the API key would have to be in the bundle. This vessel's own
 *    server is the security boundary; it holds the key and this code never sees
 *    one.
 *  - An absolute URL here would also be a rule P12 violation the moment it is
 *    bundled.
 */

import type {
  ActiveDispatch,
  DispatchOutcome,
  DispatchRequest,
  GoalWalkState,
  GradeSubmission,
  SolicitationOutcome,
  UnparsedClause,
} from "./types";

export class SurfaceError extends Error {
  readonly httpStatus: number;
  constructor(message: string, httpStatus: number) {
    super(message);
    this.name = "SurfaceError";
    this.httpStatus = httpStatus;
  }
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  if (!text) return {};
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    // A proxy that fell over can answer HTML. Say so rather than rendering
    // "undefined" into a failure slot.
    return { error: text.slice(0, 400) };
  }
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/**
 * Normalize the `unparsed` array off the wire.
 *
 * Tolerates a bare string as well as the record, because an older vessel on the
 * other end of this proxy sends strings — and a surface that renders nothing at
 * all when a clause was refused is worse than one that renders the clause with
 * no reason attached.
 */
function asClauses(raw: unknown): readonly UnparsedClause[] {
  if (!Array.isArray(raw)) return [];
  const out: UnparsedClause[] = [];
  for (const item of raw) {
    if (typeof item === "string") {
      out.push({ text: item, reason: "", suggestedGoal: "" });
      continue;
    }
    if (typeof item !== "object" || item === null) continue;
    const rec = item as Record<string, unknown>;
    const text = str(rec["text"]);
    if (!text) continue;
    out.push({
      text,
      reason: str(rec["reason"]) ?? "",
      suggestedGoal: str(rec["suggested_goal"]) ?? "",
    });
  }
  return out;
}

/* ────────────────────────────── dispatch ─────────────────────────────────── */

/**
 * `POST /api/run-goal`.
 *
 * Returns a discriminated outcome rather than throwing, because three of the
 * four responses are things the reader needs told honestly — a coalesced
 * dispatch is somebody ELSE'S older run and claiming credit for it is a lie; a
 * refusal is terminal and arrives as 200; a drain is temporary and retryable.
 */
/**
 * An instruction about the SURFACE is tried against the surface first.
 *
 * Order matters and is deliberate. The parser is a deterministic, closed set of
 * rules; it either understands an instruction or refuses it, cheaply and
 * without an LLM. Only what it refuses becomes a goal. That is the floor-first
 * arrangement the substrate asks for everywhere else — the LLM is one resolver
 * among many, never the controller — applied to the surface's own controls.
 *
 * A refusal here is NOT an error: it means "this was not about me", and the
 * instruction goes to the walk unchanged. Anything the parser understood only
 * PARTLY is reported with the clause it dropped, because silently applying half
 * an instruction is worse than applying none.
 */
async function trySurfaceIntent(instruction: string): Promise<DispatchOutcome | null> {
  let res: Response;
  try {
    res = await fetch("/api/surface-intent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ instruction }),
    });
  } catch {
    // The surface being unreachable must not swallow the instruction; let the
    // normal dispatch path run and report its own failure honestly.
    return null;
  }
  if (res.status === 422) return null; // not about the surface — send it to the walk
  if (!res.ok) return null;
  const body = (await res.json().catch(() => null)) as null | {
    applied?: boolean;
    changes?: Array<{ field?: string; from?: string; to?: string; because?: string }>;
    unparsed?: string[];
    policy?: { revision?: number };
  };
  if (!body || body.applied !== true) return null;
  return {
    kind: "reshaped",
    changes: (body.changes ?? []).map((c) => ({
      field: String(c.field ?? ""),
      from: String(c.from ?? ""),
      to: String(c.to ?? ""),
      because: String(c.because ?? ""),
    })),
    // Read the clause RECORD. The wire has always carried {text, reason,
    // suggested_goal} on both the 200 and the 422 branch; this used to be
    // `.map(String)`, which turned each one into the literal `[object Object]`
    // and discarded the only two fields that tell a person what to do next.
    unparsed: asClauses(body.unparsed),
    revision: typeof body.policy?.revision === "number" ? body.policy.revision : -1,
  };
}

export async function dispatchGoal(req: DispatchRequest): Promise<DispatchOutcome> {
  const reshaped = await trySurfaceIntent(req.goal);
  if (reshaped) return reshaped;

  const res = await fetch("/api/run-goal", {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(req),
  });
  const body = await readJson(res);

  // Branch on the flag, NOT on the status code: a refusal is 200 and an
  // acceptance is 202, so `res.ok` is true for both and tells you nothing.
  if (body.refused === true) {
    return {
      kind: "refused",
      dispatchId: str(body.dispatchId) ?? "",
      reason: str(body.goalReachReason),
    };
  }
  if (body.draining === true || res.status === 503) {
    return { kind: "draining", message: str(body.error) ?? "the dispatcher is draining" };
  }
  const dispatchId = str(body.dispatchId);
  if (res.ok && dispatchId) {
    return { kind: "accepted", dispatchId, coalesced: body.coalesced === true };
  }
  return {
    kind: "rejected",
    message: str(body.error) ?? `dispatch failed (HTTP ${res.status})`,
    httpStatus: res.status,
  };
}

/* ────────────────────────────── resolve ──────────────────────────────────── */

async function resolveShape<T>(payload: Record<string, unknown>): Promise<T> {
  const res = await fetch("/api/resolve", {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(payload),
  });
  const body = await readJson(res);
  if (!res.ok || body.resolved !== true) {
    throw new SurfaceError(str(body.error) ?? `resolve failed (HTTP ${res.status})`, res.status);
  }
  return body.body as T;
}

export function fetchWalkState(dispatchId: string): Promise<GoalWalkState> {
  return resolveShape<GoalWalkState>({ type: "goalWalkState", dispatchId });
}

export async function fetchActiveDispatches(): Promise<readonly ActiveDispatch[]> {
  const body = await resolveShape<{ dispatches?: readonly ActiveDispatch[] }>({
    type: "activeDispatches",
  });
  return Array.isArray(body?.dispatches) ? body.dispatches : [];
}

/** Answer a mid-walk question in place. */
export function answerSolicitation(args: {
  solicitationId: string;
  outcome: SolicitationOutcome;
  answer: string;
}): Promise<unknown> {
  return resolveShape({
    type: "solicitationResponse_write",
    solicitationId: args.solicitationId,
    outcome: args.outcome,
    answer: args.answer,
  });
}

/**
 * The salvage path: push context into a walk that is already running rather
 * than killing it and re-typing the goal. 409 when the dispatch is no longer
 * running — that is a real answer, not a bug, and is surfaced as one.
 */
export function injectContext(args: {
  dispatchId: string;
  shape: string;
  content: string;
  summary?: string;
}): Promise<unknown> {
  return resolveShape({ type: "poolImpulse_write", ...args });
}

/* ────────────────────────────── discovery ────────────────────────────────── */

/**
 * The fleet's shape vocabulary. Starters are derived from THIS, at render time.
 * There is no hardcoded starter list anywhere in this surface: a fixed list
 * goes stale silently and starts advertising capabilities the fleet no longer
 * has.
 *
 * ASSUMED PROXY ROUTE: `GET /api/discovery/shapes`, forwarding to discovery's
 * keyless `GET /registry/shapes` → `{ shapes: string[] }`.
 */
export async function fetchFleetShapes(): Promise<readonly string[]> {
  const res = await fetch("/api/discovery/shapes", { credentials: "same-origin" });
  if (!res.ok) throw new SurfaceError(`shape list unavailable (HTTP ${res.status})`, res.status);
  const body = await readJson(res);
  return Array.isArray(body.shapes) ? (body.shapes.filter((s) => typeof s === "string") as string[]) : [];
}

/**
 * Does anything actually serve this shape? Used to REFINE starters after they
 * have already rendered — never to gate the first paint. A surface that waits
 * on N capability lookups before showing a single suggestion has reproduced the
 * blank box it exists to remove.
 */
export async function fetchCapability(shape: string): Promise<boolean> {
  const res = await fetch("/api/discovery/resolve", {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ pointer: { type: "vesselCapability", shape } }),
  });
  if (!res.ok) return false;
  const body = await readJson(res);
  const inner = (body.body ?? body) as Record<string, unknown>;
  const producers = inner.producers ?? inner.vessels ?? inner.providers;
  if (Array.isArray(producers)) return producers.length > 0;
  return body.resolved === true;
}

/* ──────────────────────────────── grading ────────────────────────────────── */

/**
 * A human verdict into the oracle corpus.
 *
 * CONTRACT NOTE — this is the one route in this file that is not in the
 * verified proxy set. A human grade is NOT a goal-host shape: goal-host's
 * served-shape list does not include `goal_verification_label_write`, and
 * posting it to `/api/resolve` would be rejected. The real channel is
 * activity-api's impulse resolve, which goal-host itself writes to when it
 * records a machine verdict.
 *
 * The server side must therefore expose `POST /api/grade` forwarding to
 * activity-api with:
 *
 *   { pointer: { type: "goal_verification_label_write",
 *                goal, execution_id, activity_id: "unattributed",
 *                verdict, confidence: 1, labeler: "human", notes } }
 *
 * `labeler: "human"` is load-bearing — goal-host only lets a HUMAN verdict
 * override `reached`, and only a human label burns the consumption latch.
 *
 * If the route is absent this throws and the UI says so. It does not render a
 * green tick over a verdict that went nowhere.
 */
export async function submitGrade(g: GradeSubmission): Promise<void> {
  const res = await fetch("/api/grade", {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({
      execution_id: g.executionId,
      goal: g.goal,
      verdict: g.verdict,
      // A human verdict is the ground truth this corpus is FOR, so it carries
      // full confidence. Omitting the field sent `confidence: null` through the
      // proxy and the trace store rejected it — "Found NULL for field
      // `confidence` … but expected a float" — so every verdict a person
      // submitted 500'd and never reached the corpus. The doc comment above this
      // function has always specified `confidence: 1`; the body did not send it.
      confidence: 1,
      labeler: "human",
      notes: g.notes,
    }),
  });
  if (!res.ok) {
    const body = await readJson(res);
    throw new SurfaceError(
      str(body.error) ?? `the verdict was not recorded (HTTP ${res.status})`,
      res.status,
    );
  }
}


/* ────────────────────────── render policy ────────────────────────────────── */

export interface RenderPolicy {
  readonly tokenOverrides: Readonly<Record<string, string>>;
  readonly formByShape: Readonly<Record<string, string>>;
  readonly maxPreviewChars: number | null;
  readonly ledgerDefaultExpanded: boolean;
  readonly revision: number;
  readonly updatedAt: number;
  readonly note: string | null;
}

/**
 * The behaviour impulse the surface renders by. Fetched on the live cadence,
 * not at startup — a policy read once at boot would be a constant again.
 */
export async function fetchRenderPolicy(): Promise<RenderPolicy> {
  const res = await fetch("/api/render-policy", { credentials: "same-origin" });
  if (!res.ok) throw new Error(`render policy unavailable (${res.status})`);
  return (await res.json()) as RenderPolicy;
}
