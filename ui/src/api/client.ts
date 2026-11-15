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
/** In an entry's thread, a pointer argument with this value stands for the id of the row it is under (src/ui-views.ts ROW_BINDING). */
export const ROW_BINDING = "$row";

/** A pointer with each argument written as `token` replaced by `id`. */
export function bind(pointer: ReportPointer, token: string, id: string): ReportPointer {
  return Object.fromEntries(Object.entries(pointer).map(([k, v]) => [k, v === token ? id : v])) as ReportPointer;
}

/** One thing a view draws (src/ui-views.ts ViewEntry): a pointer and its form. Only the pointer is sent. */
export type ViewEntry = {
  readonly pointer: ReportPointer;
  readonly form: "fields" | "rows" | "questions";
  readonly title?: string;
  readonly field?: string;
  readonly show?: number;
  /** What a person's verdict on a row is written as: an outcome, or a land_verdict on a change. */
  readonly judge?: "outcome" | "land";
  readonly empty?: string;
  /** The fields that hold a row's words when the owner declares none (src/row-words.ts). */
  readonly words?: readonly string[];
  /** One further read drawn under each row, bound to its id through ROW_BINDING, or a list of them drawn in order; none holds a thread itself. */
  readonly thread?: ViewEntry | readonly ViewEntry[];
  /** Draw the rows `show` kept in reverse of the producer's order. */
  readonly newest?: true;
  /** Draw the entry closed under its title and its row count. */
  readonly folded?: true;
  /** Folded entries: how many rows read fall in each of the last `hours` hours, drawn in the summary. */
  readonly strip?: { readonly hours: number };
  /** The read of the system's own grades of a row (judged entries only), drawn after the person's verdict. */
  readonly graded?: { readonly pointer: ReportPointer };
  /** Each row offers to set the box to a new ask about it (listed rows only). */
  readonly about?: true;
};

/** An entry's thread as the reads drawn under each row, in its order: none, one, or the list written. */
export function threadsOf(e: ViewEntry): readonly ViewEntry[] {
  return e.thread === undefined ? [] : Array.isArray(e.thread) ? e.thread : [e.thread as ViewEntry];
}

/** What a person's row write came to: its record number and id, or why it was not recorded. */
export type RowWrite = { ok: true; seq: number; id: string } | { ok: false; reason: string; signedOut?: true; said?: string };

/**
 * A gateway's statuses: the write went out but no producer answered it (a link between machines
 * was down, or the owner was not up). The person is told so in words; what the gateway said is
 * kept, one tap away under "why".
 */
const UNREACHED = new Set([502, 503, 504]);
export const NOT_REACHED = "the system couldn't be reached.";

/**
 * A producer's answer out of what discovery returns: its `body` or `content`, and inside that,
 * for a call a vessel on another node answered, the federation transport's proxied answer
 * `{shape, produced_by, body | value, note}` (federation-transport-server.ts proxyToVessel).
 * Through the hub the rows, a stored write's `{seq, id}` and a producer's refusal all sit there.
 */
export function producerAnswer(json: Record<string, unknown>): unknown {
  const outer = json["body"] ?? json["content"] ?? json;
  if (typeof outer !== "object" || outer === null || Array.isArray(outer)) return outer;
  const o = outer as Record<string, unknown>;
  return typeof o["produced_by"] === "string" && ("body" in o || "value" in o) ? (o["body"] ?? o["value"]) : outer;
}

/**
 * A producer's refusal, as records answers one: `{failure: {status, body}}` with an error status.
 * The transport passes it on as a success, so it is read here, from the answer and from the reply
 * around it. A field named `failure` without an error status is part of an answer, not a refusal.
 */
export function failureOf(...answers: unknown[]): { status: number; said: string } | null {
  for (const a of answers) {
    const f = typeof a === "object" && a !== null && !Array.isArray(a) ? (a as Record<string, unknown>)["failure"] : undefined;
    if (typeof f !== "object" || f === null) continue;
    const r = f as Record<string, unknown>;
    if (typeof r["status"] !== "number" || r["status"] < 400) continue;
    return { status: r["status"], said: typeof r["body"] === "string" && r["body"] ? r["body"] : "refused" };
  }
  return null;
}

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
    return { ok: false, reason: NOT_REACHED, said: "the surface did not answer" };
  }
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const answer = producerAnswer(body);
  const inner = (typeof answer === "object" && answer !== null ? answer : {}) as Record<string, unknown>;
  const failure = failureOf(answer, body["body"] ?? body["content"], body);
  const said = [body["error"], body["reason"], body["detail"], inner["error"], inner["detail"], failure?.said].filter((x): x is string => typeof x === "string" && x.length > 0);
  if (res.status === 401 && body["error"] === "sign_in_required") return { ok: false, reason: "you are no longer signed in", signedOut: true };
  if (UNREACHED.has(res.status)) return { ok: false, reason: NOT_REACHED, said: [...new Set(said)].join(": ") || `status ${res.status}` };
  // Recorded is a fact records states: the stored row's seq and id. Any other answer, a 200 among them, is not a stored row.
  if (res.ok && said.length === 0 && body["success"] !== false && typeof inner["seq"] === "number" && typeof inner["id"] === "string") {
    return { ok: true, seq: inner["seq"], id: inner["id"] };
  }
  return { ok: false, reason: [...new Set(said)].join(": ") || "records did not say it was stored", said: failure ? `status ${failure.status}` : res.ok ? undefined : `status ${res.status}` };
}

/** A person's verdict on a row: an outcome row citing exactly that row. */
export function writeOutcome(rowId: string, r: 0 | 1): Promise<RowWrite> {
  return writeRow({ shape: "outcome", r, input_refs: [rowId] });
}

/**
 * A person's verdict on a change: a land_verdict row citing exactly that row, carrying its `repo`
 * and `tree` as the row has them, the keys a landing reads verdicts by. The page checks nothing
 * else: whether the change may land on it is the landing's.
 */
export function writeLandVerdict(row: Readonly<Record<string, unknown>>, r: 0 | 1): Promise<RowWrite> {
  const keys = Object.fromEntries((["repo", "tree"] as const).filter((k) => row[k] !== undefined).map((k) => [k, row[k]]));
  return writeRow({ shape: "land_verdict", r, input_refs: [row["id"]], ...keys });
}

/**
 * A person's ask: one `world_changed` row with their words. Written under their key it is
 * exogenous, so the walk takes it up from its pool; nothing is dispatched or polled. An ask
 * about another cites it (and the answer drawn under it) in `input_refs`. It carries no `r`:
 * a row with one that cites rows is a verdict to records, and would close or debit them.
 */
export function writeAsk(what: string, cites: readonly string[] = []): Promise<RowWrite> {
  return writeRow({ shape: "world_changed", what, input_refs: [...cites] });
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
export type ReportAnswer = { readonly ok: true; readonly shape: string; readonly answer: unknown } | { readonly ok: false; readonly reason: string; readonly signIn?: true; readonly refused?: true };

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
  if (!res.ok) {
    const failure = failureOf(body);
    return failure ? { ok: false, reason: failure.said, refused: true } : { ok: false, reason: said(body) ?? `no answer (${res.status})` };
  }
  const content = body["content"];
  if (typeof content === "object" && content !== null && "error" in content) return { ok: false, reason: said(content) ?? "refused" };
  if (body["success"] === false || body["resolved"] === false) return { ok: false, reason: said(body["body"]) ?? said(body) ?? "refused" };
  const answer = producerAnswer(body);
  // A producer's refusal the transport passed on as a success is a refusal, not an answer.
  const failure = failureOf(answer, body["body"] ?? content, body);
  if (failure) return { ok: false, reason: failure.said, refused: true };
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
