export interface ParticipationResponse {
  id: string;
  panelId: string;
  panelRevision?: number;
  askId?: string;
  kind: "answer" | "dismiss" | "reaction";
  value: unknown;
  receivedAt: number;
}

export interface Question {
  id: string;
  revision: number;
  title: string;
  body: unknown;
  createdAt: number;
  updatedAt: number;
  asks?: { id: string; prompt: string; type: string; choices?: string[] }[];
  responses: ParticipationResponse[];
  answered: boolean;
  declined: boolean;
  /**
   * Importance rank and its reasons, as computed by the ranker
   * (src/importance.ts `rankPanels` / `ScoredPanel.because`) and carried on the
   * questions payload. OPTIONAL because the payload does not carry them yet:
   * while they are absent, the row renders no rank attributes and the exposure
   * record says rank_source "dom_order" with a null explanation rather than
   * inventing one.
   *
   * Reader of both, in this change:
   * ui/src/lib/exposure.ts collectCandidates (reads them back off the row's
   * data-rank / data-rank-explanation attributes) → the exposure record's
   * `rank`, `rank_source`, `ranking_explanation`.
   */
  rank?: number;
  because?: string[];
}

export interface Contribution {
  panel_id: string;
  panel_revision: number;
  response_id: string;
  ask_id?: string;
  kind: "answer" | "dismiss";
  value: unknown;
}

/**
 * The honest summary the `uiQuestion` read publishes alongside the rows.
 *
 * It was ALREADY BEING SENT and was being dropped here: `fetchQuestions`
 * returned `body.questions` and discarded the rest, so the surface withheld
 * part of a ranked set honestly in the payload and silently on screen. A slice
 * that does not say it is a slice reads as the whole.
 */
export interface Ranking {
  readonly solicitations_total: number;
  readonly shown_count: number;
  readonly not_shown_count: number;
  readonly slice_size: number | null;
  readonly slice_source: string;
  /** The `renderPolicy` revision whose weights produced this order. */
  readonly policy_revision: number;
  readonly explanation?: string;
  readonly rejected_values?: readonly string[];
}

export interface QuestionPage {
  readonly questions: Question[];
  /** Null when the server did not publish a summary — an older build. Never faked. */
  readonly ranking: Ranking | null;
}

async function read(response: Response): Promise<Record<string, unknown>> {
  const body = await response.json().catch(() => null);
  if (!response.ok || !body || body.resolved !== true || body.success !== true) {
    throw new Error(body?.error ?? `The surface could not confirm the exchange (HTTP ${response.status}).`);
  }
  return body;
}

export async function fetchQuestions(): Promise<QuestionPage> {
  const result = await read(await fetch("/api/questions", { credentials: "same-origin" }));
  const body = result.body as { questions?: Question[]; ranking?: Ranking } | undefined;
  if (!Array.isArray(body?.questions)) throw new Error("The question record is unavailable.");
  // The summary is PASSED THROUGH when present and null when absent. Deriving
  // it from `questions.length` would produce a line claiming the slice is the
  // whole set — which is exactly the withholding this exists to disclose.
  const ranking =
    body?.ranking && typeof body.ranking.solicitations_total === "number" ? body.ranking : null;
  return { questions: body.questions, ranking };
}

export async function sendContribution(contribution: Contribution): Promise<ParticipationResponse> {
  const result = await read(await fetch("/api/participation", {
    method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
    body: JSON.stringify(contribution),
  }));
  const receipt = result.body as ParticipationResponse | undefined;
  if (!receipt || receipt.id !== contribution.response_id || receipt.panelId !== contribution.panel_id ||
      receipt.panelRevision !== contribution.panel_revision) {
    throw new Error("The receipt did not match this contribution. Delivery is unconfirmed.");
  }
  return receipt;
}
