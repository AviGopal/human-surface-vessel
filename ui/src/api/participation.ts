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

async function read(response: Response): Promise<Record<string, unknown>> {
  const body = await response.json().catch(() => null);
  if (!response.ok || !body || body.resolved !== true || body.success !== true) {
    throw new Error(body?.error ?? `The surface could not confirm the exchange (HTTP ${response.status}).`);
  }
  return body;
}

export async function fetchQuestions(): Promise<Question[]> {
  const result = await read(await fetch("/api/questions", { credentials: "same-origin" }));
  const body = result.body as { questions?: Question[] } | undefined;
  if (!Array.isArray(body?.questions)) throw new Error("The question record is unavailable.");
  return body.questions;
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
