/**
 * Response forms per reader. Each form builds exactly what its reader parses, and
 * says what became of the answer — applied, replaced, waiting, or read by nothing.
 *
 * See openspec/changes/surface-participation-loop/design.md §2–§4.
 */

import { useState, type ReactNode } from "react";
import type { ParticipationResponse } from "../api/participation";
import { useGap } from "../api/queries";
import {
  DISPOSITIONS,
  VERIFICATION_CHOICES,
  VERIFICATION_LABELS,
  appliedDisposition,
  buildEscalationAnswer,
  checkEscalationAnswer,
  dispositionLabel,
  outcomeOf,
  parseDisposition,
  type DispositionVerb,
} from "../lib/disposition";
import { humanChoice, type InteractionState } from "../lib/interaction";
import { ChoiceInput, InteractionFooter, TextInput } from "./Interaction";

export interface FormProps {
  readonly send: (kind: "answer" | "dismiss", value: unknown) => void;
  readonly state: InteractionState;
  readonly error: string | null;
  readonly revised: boolean;
}

function DeclineButton({ send, state, revised }: FormProps): ReactNode {
  return (
    <button type="button" className="sf-button" disabled={state === "pending" || revised} onClick={() => send("dismiss", "")}>
      Decline
    </button>
  );
}

function ago(iso: string | null): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return "";
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 90) return `${s}s ago`;
  const m = Math.round(s / 60);
  return m < 90 ? `${m}m ago` : `${Math.round(m / 60)}h ago`;
}

/* ── escalations (needs-human-*, reland-needs-human-*) ─────────────────────── */

/** What the gap says about this answer — read back from the gap store. */
export function EscalationOutcome({ gapId, response }: { gapId: string; response: ParticipationResponse | null }): ReactNode {
  const waiting = response !== null;
  const gap = useGap(gapId, { enabled: true, intervalMs: waiting ? 15_000 : false });
  if (gap.isError) return <p className="sf-outcome-strip" data-outcome="error">Couldn't read the gap back: {(gap.error as Error).message}</p>;
  if (gap.data === undefined) return null;
  if (gap.data === null) return <p className="sf-outcome-strip" data-outcome="error">The gap {gapId} is no longer in the store.</p>;
  const applied = appliedDisposition(gap.data);
  if (!response) {
    return applied?.verb ? (
      <p className="sf-outcome-strip" data-outcome="previous">
        Last decision applied: <b>{dispositionLabel(applied.verb)}</b> {ago(applied.at)}
      </p>
    ) : null;
  }
  const outcome = outcomeOf(response.id, response.receivedAt, applied);
  if (outcome.kind === "waiting" && parseDisposition(typeof response.value === "string" ? response.value : JSON.stringify(response.value ?? "")) === null) {
    return (
      <p className="sf-outcome-strip" data-outcome="not_understood">
        ✗ Your last answer names no decision, so it was not applied. Choose one of the four above.
      </p>
    );
  }
  if (outcome.kind === "applied") {
    const a = outcome.applied;
    const effect =
      a.status === "closed"
        ? "gap closed"
        : `gap reopened${a.attemptsRemaining !== null ? ` with ${a.attemptsRemaining} repair attempts` : ""}`;
    return (
      <p className="sf-outcome-strip" data-outcome="applied">
        ✓ Applied — <b>{dispositionLabel(a.verb)}</b> · {effect}
        {a.editSite ? <> · change site <span className="sf-mono">{a.editSite}</span></> : null} · {ago(a.at)}
      </p>
    );
  }
  if (outcome.kind === "superseded") {
    return (
      <p className="sf-outcome-strip" data-outcome="superseded">
        ↺ A later answer was applied instead — <b>{dispositionLabel(outcome.applied.verb)}</b> {ago(outcome.applied.at)}
      </p>
    );
  }
  return (
    <p className="sf-outcome-strip" data-outcome="waiting">
      … Sent — not applied yet. The applier runs periodically (it has taken up to half an hour); this updates when it does.
    </p>
  );
}

export function EscalationForm(props: FormProps): ReactNode {
  const { send, state, error, revised } = props;
  const [verb, setVerb] = useState<DispositionVerb | null>(null);
  const [details, setDetails] = useState("");
  const [editSite, setEditSite] = useState("");
  const [verifyShape, setVerifyShape] = useState("");

  const answer = verb ? { verb, details, editSite, verifyShape } : null;
  const problem = answer ? checkEscalationAnswer(answer) : null;
  // Redefining or supplying a fact is the answer's content; a bare verb would reopen the gap with nothing new.
  const needsDetails = (verb === "redefine" || verb === "provide_information") && details.trim().length === 0;

  let blocker: string | null = null;
  if (problem?.kind === "verb_flip") {
    blocker = problem.readAs
      ? `Your details contain wording the applier reads as “${dispositionLabel(problem.readAs)}”, and it checks that before “${dispositionLabel(verb)}”. Reword the details.`
      : "The applier would not recognise this decision. Reword the details.";
  } else if (problem) {
    blocker = problem.message;
  }

  return (
    <form
      className="sf-view-section sf-respond sf-interaction"
      onSubmit={(e) => {
        e.preventDefault();
        if (answer && !problem && !needsDetails) send("answer", buildEscalationAnswer(answer));
      }}
    >
      <ChoiceInput
        label="What should happen to this gap?"
        options={DISPOSITIONS.map((d) => d.verb)}
        labels={Object.fromEntries(DISPOSITIONS.map((d) => [d.verb, `${d.label} — ${d.hint}`]))}
        value={verb}
        onChange={(v) => setVerb(v as DispositionVerb)}
        disabled={revised || state === "pending"}
      />
      <TextInput
        label="Details"
        placeholder={verb === "drop" ? "Why (optional)" : verb === "provide_information" ? "The fact it is missing" : "Details"}
        value={details}
        onChange={setDetails}
        disabled={revised || state === "pending"}
      />
      <details className="sf-respond-more">
        <summary>Where the fix goes (optional)</summary>
        <div className="sf-respond-fields">
          <label className="sf-ix-field">
            <span className="sf-ix-label">Change site</span>
            <TextInput label="Change site" placeholder="repos/<vessel>/src/…" value={editSite} onChange={setEditSite} singleLine mono disabled={state === "pending"} />
          </label>
          <label className="sf-ix-field">
            <span className="sf-ix-label">Verify with shape</span>
            <TextInput label="Verify with shape" placeholder="web_search" value={verifyShape} onChange={setVerifyShape} singleLine mono disabled={state === "pending"} />
          </label>
        </div>
      </details>
      <InteractionFooter
        state={state}
        submitLabel="Send"
        canSubmit={!revised && verb !== null && !problem && !needsDetails}
        error={blocker ?? error}
        sentLabel="Sent"
        secondary={<DeclineButton {...props} />}
      />
    </form>
  );
}

/* ── kinds nothing reads yet ───────────────────────────────────────────────── */

export function UnreadNote(): ReactNode {
  return <p className="sf-outcome-strip" data-outcome="unread">Recorded — nothing acts on this kind of answer yet.</p>;
}

/** "Did the fix work?" — typed so answers given now are machine-readable when a reader lands. */
export function VerificationForm(props: FormProps): ReactNode {
  const { send, state, error, revised } = props;
  const [choice, setChoice] = useState<string | null>(null);
  const [details, setDetails] = useState("");
  return (
    <form
      className="sf-view-section sf-respond sf-interaction"
      onSubmit={(e) => {
        e.preventDefault();
        if (choice) send("answer", { answer: humanChoice(choice), details: details.trim() });
      }}
    >
      <ChoiceInput
        label="Did the landed change fix it?"
        options={VERIFICATION_CHOICES}
        labels={VERIFICATION_LABELS}
        value={choice}
        onChange={setChoice}
        disabled={revised || state === "pending"}
      />
      <TextInput label="Details" placeholder="What you checked (optional)" value={details} onChange={setDetails} disabled={revised || state === "pending"} />
      <InteractionFooter state={state} submitLabel="Send" canSubmit={!revised && choice !== null} error={error} sentLabel="Recorded" secondary={<DeclineButton {...props} />} />
      <UnreadNote />
    </form>
  );
}

/** "Where should the change go?" — sent in the `EDIT_SITE:` convention the escalation applier already reads. */
export function LocalizationForm(props: FormProps): ReactNode {
  const { send, state, error, revised } = props;
  const [site, setSite] = useState("");
  const [details, setDetails] = useState("");
  const [outOfReach, setOutOfReach] = useState(false);
  const s = site.trim();
  const siteOk = s.startsWith("repos/") && !s.includes("..") && !/\s/.test(s);
  return (
    <form
      className="sf-view-section sf-respond sf-interaction"
      onSubmit={(e) => {
        e.preventDefault();
        const lines = outOfReach ? ["OUT_OF_CODE_REACH"] : [`EDIT_SITE: ${s}`];
        if (details.trim()) lines.push(details.trim());
        send("answer", lines.join("\n"));
      }}
    >
      <label className="sf-ix-field">
        <span className="sf-ix-label">The file this gap should change</span>
        <TextInput label="Change site" placeholder="repos/<vessel>/src/…" value={site} onChange={setSite} singleLine mono disabled={outOfReach || revised || state === "pending"} />
      </label>
      <label className="sf-ix-option">
        <input type="checkbox" checked={outOfReach} onChange={(e) => setOutOfReach(e.target.checked)} /> It is out of code reach
      </label>
      <TextInput label="Details" placeholder="Why (optional)" value={details} onChange={setDetails} disabled={revised || state === "pending"} />
      <InteractionFooter
        state={state}
        submitLabel="Send"
        canSubmit={!revised && (outOfReach || siteOk)}
        error={!outOfReach && s && !siteOk ? "A change site must be a path starting with repos/, with no spaces or '..'." : error}
        sentLabel="Recorded"
        secondary={<DeclineButton {...props} />}
      />
      <UnreadNote />
    </form>
  );
}
