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

import type { DispatchOutcome, OnScreenReport, UnparsedClause } from "./types";

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
export async function trySurfaceIntent(instruction: string, onScreen: OnScreenReport | null = null): Promise<DispatchOutcome | null> {
  let res: Response;
  try {
    res = await fetch("/api/surface-intent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ instruction, onScreen }),
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
    view?: { form?: string };
    refused?: { reason?: string };
  };
  // About the output on screen: one view changes and nothing is written.
  if (body?.view && typeof body.view.form === "string") return { kind: "view", form: body.view.form };
  if (body?.refused) return { kind: "viewRefused", reason: String(body.refused.reason ?? "") };
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

export interface RenderPolicy {
  readonly tokenOverrides: Readonly<Record<string, string>>;
  readonly formByShape: Readonly<Record<string, string>>;
  /** Forms a learner earned per shape; applied below a human pin. Absent on older policies. */
  readonly learnedFormByShape?: Readonly<Record<string, string>>;
  readonly maxPreviewChars: number | null;
  readonly ledgerDefaultExpanded: boolean;
  /** Repertoire variant chosen through the impulse; adopted at page load only. */
  readonly presentation?: "onepage" | "stacked";
  /** How often the page looks again (src/recheck.ts); absent on older policies. */
  readonly recheck?: Readonly<Record<string, number>>;
  /** How much the page draws (src/limits.ts); absent on older policies. */
  readonly limits?: Readonly<Record<string, number>>;
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

/** The view a region draws (src/ui-views.ts): its entries in order, and a newer view passed over. */
export interface UiViewState {
  readonly region: string;
  readonly revision: number;
  readonly id: string;
  readonly entries: readonly ViewEntry[];
  readonly writtenBy?: string | null;
  /** A newer stored view that is not drawn, and why; null when the newest is in force. */
  readonly notDrawn?: { readonly id: string; readonly refusal: string; readonly detail: string } | null;
}

type Plain = string | number | boolean;
/** A read's pointer: plain arguments, and at most records' `where` ({field: value}, by equality) in a `graded` read. */
export type ReportPointer = Readonly<Record<string, Plain | Readonly<Record<string, Plain>>>> & { readonly type: string };
/** In the `ask` region, a pointer argument with this value stands for the ask's row id (src/ui-views.ts ASK_BINDING). */
export const ASK_BINDING = "$ask";
/** In an entry's thread, a pointer argument with this value stands for the id of the row it is under (src/ui-views.ts ROW_BINDING). */
export const ROW_BINDING = "$row";

/** A pointer with each argument written as `token` replaced by `id`. */
export function bind(pointer: ReportPointer, token: string, id: string): ReportPointer {
  return Object.fromEntries(Object.entries(pointer).map(([k, v]) => [k, v === token ? id : v])) as ReportPointer;
}

/** A pointer with each ASK_BINDING argument replaced by the ask's row id. */
export function bindAsk(pointer: ReportPointer, askId: string): ReportPointer {
  return bind(pointer, ASK_BINDING, askId);
}

/** One thing a view draws (src/ui-views.ts ViewEntry): a pointer and its form. Only the pointer is sent. */
export type ViewEntry = {
  readonly pointer: ReportPointer;
  readonly form: "fields" | "rows" | "questions";
  readonly title?: string;
  readonly field?: string;
  readonly show?: number;
  readonly judge?: "outcome";
  readonly empty?: string;
  /** The fields that hold a row's words when the owner declares none (src/row-words.ts). */
  readonly words?: readonly string[];
  /** One further read drawn under each row, bound to its id through ROW_BINDING; it holds no thread itself. */
  readonly thread?: ViewEntry;
  /** Draw the rows `show` kept in reverse of the producer's order. */
  readonly newest?: true;
  /** Draw the entry closed under its title and its row count. */
  readonly folded?: true;
  /** Folded entries: how many rows read fall in each of the last `hours` hours, drawn in the summary. */
  readonly strip?: { readonly hours: number };
  /** The read of the system's own grades of a row (judged entries only), drawn after the person's verdict. */
  readonly graded?: { readonly pointer: ReportPointer };
};

/** What a person's row write came to: its record number and id, or why it was not recorded. */
export type RowWrite = { ok: true; seq: number | null; id: string | null } | { ok: false; reason: string; signedOut?: true };

/**
 * A row a person writes to records, through discovery. The surface sends it under the
 * signed-in person's own key and refuses it signed out (routes/proxy.ts), so records names
 * the person as its writer.
 */
async function writeRow(row: Record<string, unknown>): Promise<RowWrite> {
  let res: Response;
  try {
    res = await fetch("/api/discovery/resolve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ pointer: { type: "record_write", row } }),
    });
  } catch {
    return { ok: false, reason: "the surface did not answer" };
  }
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const inner = (body["body"] ?? body["content"] ?? body) as Record<string, unknown>;
  const said = [body["error"], body["reason"], body["detail"], inner?.["error"], inner?.["detail"]].filter((x): x is string => typeof x === "string" && x.length > 0);
  if (res.status === 401 && body["error"] === "sign_in_required") return { ok: false, reason: "you are no longer signed in", signedOut: true };
  if (!res.ok || said.length > 0 || body["success"] === false) return { ok: false, reason: [...new Set(said)].join(": ") || `not recorded (${res.status})` };
  return {
    ok: true,
    seq: typeof inner?.["seq"] === "number" ? (inner["seq"] as number) : null,
    id: typeof inner?.["id"] === "string" ? (inner["id"] as string) : null,
  };
}

/** A person's verdict on a row: an outcome row citing exactly that row. */
export function writeOutcome(rowId: string, r: 0 | 1): Promise<RowWrite> {
  return writeRow({ shape: "outcome", r, input_refs: [rowId] });
}

/**
 * A person's ask: one `world_changed` row with their words. Written under their key it is
 * exogenous, so the walk takes it up from its pool; nothing is dispatched or polled.
 */
export function writeAsk(what: string): Promise<RowWrite> {
  return writeRow({ shape: "world_changed", what, input_refs: [] });
}

/**
 * A person's complaint about what is on screen: a `world_changed` row with their words, as
 * typed, and what it is about. It goes where an ask goes, so the walk takes it up from its
 * pool. A question on this surface is not a records row, so it is named in the words, not
 * cited in `input_refs`.
 */
export function writeComplaint(text: string, about: string | null): Promise<RowWrite> {
  return writeRow({ shape: "world_changed", what: about ? `${text} (about question ${about})` : text, input_refs: [] });
}

/** A report's answer, or why there is none. `answer` is what the producer returned, uninterpreted. */
/**
 * `signIn` marks the one refusal a person can act on: the surface sends a lookup only under the
 * signed-in person's own key (src/routes/proxy.ts), and with no one signed in it answers 401
 * `sign_in_required`. The page says "sign in" for it, in a person's words, not the refusal's.
 */
export type ReportAnswer = { readonly ok: true; readonly shape: string; readonly answer: unknown } | { readonly ok: false; readonly reason: string; readonly signIn?: true };

/**
 * One report, resolved by shape through discovery (the surface's own passthrough), so
 * whichever vessel serves it answers. Every way a read comes back empty is a reason,
 * never an exception: a producer that refused, timed out or answered an error.
 */
export async function fetchReport(pointer: ReportPointer): Promise<ReportAnswer> {
  let res: Response;
  try {
    res = await fetch("/api/discovery/resolve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ pointer }),
    });
  } catch {
    return { ok: false, reason: "the surface did not answer" };
  }
  const body = await readJson(res).catch(() => ({}) as Record<string, unknown>);
  const said = (o: unknown): string | null => {
    if (typeof o !== "object" || o === null) return typeof o === "string" && o ? o : null;
    const r = o as Record<string, unknown>;
    const parts = [r["error"], r["reason"], r["detail"], r["note"]].filter((x): x is string => typeof x === "string" && x.length > 0);
    return parts.length ? [...new Set(parts)].join(": ") : null;
  };
  if (res.status === 401 && body["error"] === "sign_in_required") return { ok: false, reason: said(body) ?? "sign in", signIn: true };
  if (!res.ok) return { ok: false, reason: said(body) ?? `no answer (${res.status})` };
  const content = body["content"];
  if (typeof content === "object" && content !== null && "error" in content) return { ok: false, reason: said(content) ?? "refused" };
  if (body["success"] === false || body["resolved"] === false) return { ok: false, reason: said(body["body"]) ?? said(body) ?? "refused" };
  const answer = body["body"] ?? content ?? body;
  if (typeof answer === "object" && answer !== null && !Array.isArray(answer) && "error" in answer) {
    return { ok: false, reason: said(answer) ?? "refused" };
  }
  return { ok: true, shape: typeof body["shape"] === "string" ? body["shape"] : pointer.type, answer };
}

/** A region's view, read on the live cadence like the render policy: a view the system writes shows without a reload. */
export async function fetchUiView(region: string): Promise<UiViewState> {
  const res = await fetch(`/api/ui-view?region=${encodeURIComponent(region)}`, { credentials: "same-origin" });
  if (!res.ok) throw new Error(`view unavailable (${res.status})`);
  return (await res.json()) as UiViewState;
}

/** A gap as the gap store returns it; only the fields the surface reads are typed. */
export interface GapRecord {
  readonly id: string;
  readonly status?: string;
  readonly summary?: string;
  readonly classification_metadata?: Record<string, unknown>;
  readonly updated_at?: string;
}

/** One gap by id. Null when the store answered and has no such gap. */
export async function fetchGap(id: string): Promise<GapRecord | null> {
  const res = await fetch(`/api/gaps/${encodeURIComponent(id)}`, { credentials: "same-origin" });
  const body = (await res.json().catch(() => null)) as { gap?: GapRecord | null; error?: string } | null;
  // Absence is a STATEMENT the route makes ({gap:null}), not any 404. A server
  // missing this route answers 404 too, and reading that as "no longer in the
  // store" told the reader every escalation's gap had vanished (10-02: the live
  // server ran a proxy.ts without the route).
  if (res.status === 404 && body !== null && "gap" in body && body.gap === null) return null;
  if (!res.ok) throw new Error(body?.error ?? `not checked (${res.status})`);
  if (!body || !("gap" in body)) throw new Error("not checked");
  return body.gap ?? null;
}
