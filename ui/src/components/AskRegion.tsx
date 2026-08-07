/**
 * ASK — one box, and what happens the moment you use it.
 *
 * A human sends goals in natural language. This surface does not ask anyone to
 * pre-decompose a request, name a target shape, or speak the system's internal
 * vocabulary: if a goal only works after somebody rewrites it with file paths
 * and expected shapes, that rewriting is a gap in the system, not a workflow to
 * institutionalise here.
 *
 * The run contract appears ON SUBMIT, not before — it describes the walk that
 * was just accepted, and it carries a duration BAND rather than an estimate and
 * no confidence number at all.
 */

import { useRef, useState, type ReactNode } from "react";
import { useDispatchGoal, useFleetShapes } from "../api/queries";
import type { DispatchOutcome } from "../api/types";
import { buildContract, type RunContract } from "../lib/contract";
import { inferTargetShapes } from "../lib/starters";
import { formatDurationBand } from "../lib/time";
import { StarterChips } from "./StarterChips";

function ContractPanel({ contract, goal }: { contract: RunContract; goal: string }): ReactNode {
  return (
    <div className="sf-contract">
      <dl>
        <dt>What this is</dt>
        <dd>{contract.klass}</dd>

        <dt>Aiming at</dt>
        <dd>
          {contract.targetShapes.length > 0 ? (
            <>
              {contract.targetShapes.map((shape, i) => (
                <span key={shape}>
                  {i > 0 ? ", " : ""}
                  <span className="sf-mono">{shape}</span>
                </span>
              ))}{" "}
              <span className="sf-muted">
                — inferred from your wording against the live vocabulary. The walk decides for
                itself; this is what it looks like it is heading for.
              </span>
            </>
          ) : (
            <span className="sf-muted">
              Nothing in your wording matched a known shape name. The walk will infer its own
              targets — this is not a problem, only something this surface cannot preview.
            </span>
          )}
        </dd>

        <dt>How long</dt>
        <dd>
          {formatDurationBand(contract.lowSec, contract.highSec)}
          <br />
          <span className="sf-muted">{contract.bandBasis}.</span>
        </dd>

        <dt>It will ask you about</dt>
        <dd>
          <ul style={{ margin: 0, paddingLeft: "var(--sf-space-5)" }}>
            {contract.willAskAbout.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </dd>

        <dt>What was sent</dt>
        <dd className="sf-mono sf-muted">{goal}</dd>
      </dl>
    </div>
  );
}

function OutcomeNote({ outcome }: { outcome: DispatchOutcome }): ReactNode {
  switch (outcome.kind) {
    case "reshaped":
      // Say plainly that NOTHING was dispatched. The reader is watching a runs
      // board; if this read like an acceptance they would wait for a row that
      // is never coming.
      return (
        <p className="sf-outcome" role="status">
          This changed the interface itself — nothing was dispatched and no run will appear below.
          {outcome.revision >= 0 ? ` Render policy is now revision ${outcome.revision}.` : ""}
          <ul className="sf-outcome-changes">
            {outcome.changes.map((c) => (
              <li key={`${c.field}-${c.to}`}>
                <b>{c.field}</b>: {c.from} → {c.to}
                {c.because ? <span className="sf-outcome-because"> · from “{c.because}”</span> : null}
              </li>
            ))}
          </ul>
          {outcome.unparsed.length > 0 ? (
            <span className="sf-outcome-unparsed">
              Not understood, and therefore not applied:{" "}
              {outcome.unparsed.map((u) => `“${u}”`).join(", ")}. The rest was applied.
            </span>
          ) : null}
        </p>
      );
    case "accepted":
      return outcome.coalesced ? (
        <p className="sf-warn">
          Coalesced onto an existing run ({outcome.dispatchId}). This is an OLDER dispatch that was
          already in flight for the same goal — you did not create it, and it may already be part
          way through. What it produces will answer someone else's ask as much as yours.
        </p>
      ) : (
        <p className="sf-ok">
          Accepted as {outcome.dispatchId}. Accepted means the walk was received — not that anything
          has happened yet. The board says what it actually does.
        </p>
      );
    case "refused":
      return (
        <p className="sf-error">
          Refused before anything ran{outcome.dispatchId ? ` (${outcome.dispatchId})` : ""}.{" "}
          {outcome.reason ?? "No reason was given."} Nothing was dispatched and nothing will appear
          on the board.
        </p>
      );
    case "draining":
      return (
        <p className="sf-warn">
          The dispatcher is draining and did not take this: {outcome.message}. It is shutting down
          or restarting — retry shortly. Your goal was not queued.
        </p>
      );
    case "rejected":
    default:
      return (
        <p className="sf-error">
          Not dispatched: {outcome.message}. Nothing ran.
        </p>
      );
  }
}

export function AskRegion({ onDispatched }: { onDispatched: (dispatchId: string) => void }): ReactNode {
  const [goal, setGoal] = useState("");
  const [contract, setContract] = useState<{ contract: RunContract; goal: string } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const shapes = useFleetShapes();
  const dispatch = useDispatchGoal();

  /** P2: insert and focus. This function cannot dispatch — nothing here can. */
  const insert = (text: string): void => {
    setGoal((current) => (current.trim().length === 0 ? text : `${current.trimEnd()} ${text}`));
    const el = textareaRef.current;
    if (el) {
      el.focus();
      // Cursor at the end, so finishing the sentence is the obvious next act.
      window.requestAnimationFrame(() => {
        el.selectionStart = el.value.length;
        el.selectionEnd = el.value.length;
      });
    }
  };

  const submit = (): void => {
    const text = goal.trim();
    if (text.length === 0) return;
    const inferred = inferTargetShapes(text, shapes.data ?? []);
    setContract({ contract: buildContract(text, inferred), goal: text });
    dispatch.mutate(
      { goal: text, operator: "human-surface", tags: ["surface:do-anything"] },
      {
        onSuccess: (outcome) => {
          // The contract describes A WALK THAT WILL RUN. It is built optimistically
          // on submit, because the reader deserves to see it before the wait — but
          // only ACCEPTED means a walk actually runs. On every other outcome it is
          // withdrawn, or the surface would show "what will happen" beside "nothing
          // was dispatched" and contradict itself in one frame. That is the exact
          // failure this surface exists to prevent, so it must not commit it.
          if (outcome.kind !== "accepted") setContract(null);
          if (outcome.kind === "accepted" && outcome.dispatchId) onDispatched(outcome.dispatchId);
          // "reshaped" deliberately falls through: there is no run to select.
          if (outcome.kind === "refused" && outcome.dispatchId) onDispatched(outcome.dispatchId);
        },
      },
    );
  };

  return (
    <section className="sf-region" aria-labelledby="sf-ask-title">
      <div className="sf-region-head">
        <h2 className="sf-region-title" id="sf-ask-title">
          Ask
        </h2>
      </div>
      <div className="sf-region-body">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <label htmlFor="sf-goal" className="sf-visually-hidden">
            What do you want done?
          </label>
          <textarea
            id="sf-goal"
            ref={textareaRef}
            className="sf-textarea"
            placeholder="What do you want done?"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                submit();
              }
            }}
          />
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--sf-space-3)",
              marginTop: "var(--sf-space-3)",
            }}
          >
            <button
              type="submit"
              className="sf-button sf-button-primary"
              disabled={goal.trim().length === 0 || dispatch.isPending}
            >
              {dispatch.isPending ? "Sending…" : "Send"}
            </button>
            <span className="sf-note sf-muted">⌘/Ctrl + Enter</span>
            {contract ? (
              <button
                type="button"
                className="sf-button sf-button-quiet"
                onClick={() => {
                  setContract(null);
                  dispatch.reset();
                }}
              >
                dismiss the contract
              </button>
            ) : null}
          </div>
        </form>

        <StarterChips onInsert={insert} />

        {dispatch.isError ? (
          <p className="sf-error">
            The dispatch never left this surface: {(dispatch.error as Error).message}. Nothing ran.
          </p>
        ) : null}
        {dispatch.data ? <OutcomeNote outcome={dispatch.data} /> : null}
        {contract ? <ContractPanel contract={contract.contract} goal={contract.goal} /> : null}
      </div>
    </section>
  );
}
