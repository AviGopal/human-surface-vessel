/**
 * The top bar: one box to ask in, and the page-wide controls.
 *
 * A human sends goals in natural language; nothing here asks them to name a
 * shape. An accepted send opens its run in the main pane — the run IS the
 * outcome, so there is no separate note about it. Only an outcome with no run
 * to open (refused, draining, rejected, or a change to this interface) speaks
 * here, in one line.
 */

import { useMutation } from "@tanstack/react-query";
import { useRef, useState, type ReactNode } from "react";
import { trySurfaceIntent } from "../api/client";
import { useDispatchGoal } from "../api/queries";
import type { DispatchOutcome } from "../api/types";
import { boxWords, presentationScope, readAs, type BoxContext, NEW_ASK } from "../lib/box";
import { useLiveControls } from "../state/liveControls";
import { useQuestions } from "../state/questions";
import { answerRunQuestion } from "./RunQuestion";
import { StarterChips } from "./StarterChips";

const MAX_BOX_LINES = 8;

function OutcomeLine({
  outcome,
  onSuggest,
  onDismiss,
}: {
  outcome: DispatchOutcome;
  onSuggest: (text: string) => void;
  onDismiss: () => void;
}): ReactNode {
  let body: ReactNode = null;
  let tone = "error";
  switch (outcome.kind) {
    case "accepted":
      if (!outcome.coalesced) return null;
      tone = "warn";
      body = <>Joined a run already in flight for the same goal</>;
      break;
    case "reshaped":
      tone = "ok";
      body = (
        <>
          Interface changed:{" "}
          {outcome.changes.map((c) => (
            <span key={`${c.field}-${c.to}`} className="sf-chip sf-chip-quiet">
              {c.field} → {c.to} · for {presentationScope(c.field)}
            </span>
          ))}
          {outcome.unparsed.map((u) => (
            <span key={u.text} className="sf-outcome-unparsed">
              not understood: “{u.text}”
              {u.suggestedGoal ? (
                // Inserts into the box; it never sends.
                <button type="button" className="sf-button sf-button-quiet" onClick={() => onSuggest(u.suggestedGoal)}>
                  use “{u.suggestedGoal}”
                </button>
              ) : null}
            </span>
          ))}
        </>
      );
      break;
    case "refused":
      body = <>Refused: {outcome.reason ?? "no reason given"}</>;
      break;
    case "draining":
      tone = "warn";
      body = <>Dispatcher restarting — not sent, retry shortly</>;
      break;
    case "rejected":
    default:
      body = <>Not sent: {outcome.message}</>;
  }
  return (
    <div className="sf-outcome-line" data-tone={tone} role="status">
      <span>{body}</span>
      <button type="button" className="sf-icon-button" aria-label="Dismiss" onClick={onDismiss}>
        ×
      </button>
    </div>
  );
}

export function TopBar({
  onDispatched,
  openIssues,
  onToggleIssues,
  issuesOpen,
  calibration = null,
  context = NEW_ASK,
  onSetAside,
}: {
  onDispatched: (dispatchId: string) => void;
  /** What the next message will be read as; the chip shows it. */
  context?: BoxContext;
  /** × on the chip: read the next message as a new ask instead. */
  onSetAside?: () => void;
  openIssues: number | null;
  onToggleIssues: () => void;
  issuesOpen: boolean;
  /** An open, attested calibration window; absent otherwise. */
  calibration?: { count: number; open: () => void } | null;
}): ReactNode {
  const [goal, setGoal] = useState("");
  const [focused, setFocused] = useState(false);
  const boxRef = useRef<HTMLTextAreaElement | null>(null);
  const dispatch = useDispatchGoal();
  const { paused, setPaused } = useLiveControls();
  const { recordReceipt } = useQuestions();
  const [echo, setEcho] = useState<string | null>(null);
  const [reshaped, setReshaped] = useState<DispatchOutcome | null>(null);
  const answer = useMutation({
    retry: false,
    // A presentation phrase is read as one in any context: checked before the text
    // is taken as the run's answer, so "show this as a table" never reaches the run.
    mutationFn: async (args: { ctx: Extract<BoxContext, { kind: "reply" }>; text: string }) => {
      const change = await trySurfaceIntent(args.text);
      if (change) return { kind: "reshaped" as const, change };
      const receipt = await answerRunQuestion(args.ctx.question, "answered", args.text);
      recordReceipt(receipt);
      return { kind: "answered" as const };
    },
  });
  const words = boxWords(context);
  const pending = dispatch.isPending || answer.isPending;

  const fit = (el: HTMLTextAreaElement | null): void => {
    if (!el) return;
    el.style.height = "auto";
    const line = parseFloat(getComputedStyle(el).lineHeight) || 20;
    el.style.height = `${Math.min(el.scrollHeight, line * MAX_BOX_LINES + 16)}px`;
  };

  const put = (text: string, append: boolean): void => {
    setGoal((current) => (append && current.trim().length > 0 ? `${current.trimEnd()} ${text}` : text));
    const el = boxRef.current;
    if (el) {
      el.focus();
      window.requestAnimationFrame(() => {
        el.selectionStart = el.value.length;
        el.selectionEnd = el.value.length;
        fit(el);
      });
    }
  };

  const cleared = (): void => {
    setGoal("");
    window.requestAnimationFrame(() => fit(boxRef.current));
  };

  const submit = (): void => {
    const text = goal.trim();
    if (text.length === 0 || pending) return;
    if (context.kind === "reply") {
      const ctx = context;
      dispatch.reset();
      setReshaped(null);
      answer.mutate(
        { ctx, text },
        {
          onSuccess: (r) => {
            if (r.kind === "reshaped") {
              setEcho(null);
              setReshaped(r.change);
            } else {
              setEcho(`${readAs(ctx)} · delivered`);
            }
            cleared();
          },
        },
      );
      return;
    }
    answer.reset();
    setEcho(null);
    setReshaped(null);
    dispatch.mutate(
      { goal: text, operator: "human-surface", tags: ["surface:do-anything"] },
      {
        onSuccess: (outcome) => {
          if ((outcome.kind === "accepted" || outcome.kind === "refused") && outcome.dispatchId) {
            onDispatched(outcome.dispatchId);
          }
          if (outcome.kind === "accepted") cleared();
        },
      },
    );
  };

  return (
    <header className="sf-top">
      <form
        className="sf-ask-bar"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <span className="sf-box-chip" data-context={context.kind} aria-live="polite">
          {words.chip}
          {context.kind === "reply" && onSetAside ? (
            <button type="button" className="sf-icon-button" aria-label="Ask something new instead" onClick={onSetAside}>
              ×
            </button>
          ) : null}
        </span>
        <div className="sf-ask-field">
          <textarea
            ref={boxRef}
            rows={1}
            aria-label={words.placeholder}
            className="sf-ask-box"
            placeholder={words.placeholder}
            value={goal}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onChange={(e) => {
              setGoal(e.target.value);
              fit(e.target);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
          />
          {focused && goal.trim().length === 0 && context.kind === "new" ? (
            // mousedown is swallowed so choosing a chip does not blur the box first.
            <div className="sf-ask-suggest" onMouseDown={(e) => e.preventDefault()}>
              <StarterChips onInsert={(text) => put(text, true)} />
            </div>
          ) : null}
        </div>
        <button type="submit" className="sf-button sf-button-primary" disabled={goal.trim().length === 0 || pending}>
          {pending ? "Sending…" : words.send}
        </button>
      </form>

      <div className="sf-top-controls">
        <button
          type="button"
          className="sf-button sf-button-quiet"
          aria-pressed={paused}
          title={paused ? "Updates paused" : "Updating live"}
          onClick={() => setPaused(!paused)}
        >
          <span className="sf-live-dot" data-paused={paused} aria-hidden="true" />
          {paused ? "Paused" : "Live"}
        </button>
        <button
          type="button"
          className="sf-button sf-button-quiet"
          aria-expanded={issuesOpen}
          aria-controls="sf-issues"
          onClick={onToggleIssues}
        >
          Issues{openIssues !== null ? <span className="sf-count">{openIssues}</span> : null}
        </button>
        {calibration ? (
          <button type="button" className="sf-button sf-button-quiet" onClick={calibration.open}>
            Calibrate<span className="sf-count">{calibration.count}</span>
          </button>
        ) : null}
      </div>

      {dispatch.isError ? (
        <div className="sf-outcome-line" data-tone="error" role="status">
          <span>Not sent: {(dispatch.error as Error).message}</span>
          <button type="button" className="sf-icon-button" aria-label="Dismiss" onClick={() => dispatch.reset()}>
            ×
          </button>
        </div>
      ) : null}
      {answer.isError ? (
        <div className="sf-outcome-line" data-tone="error" role="status">
          <span>Not delivered: {(answer.error as Error).message}</span>
          <button type="button" className="sf-icon-button" aria-label="Dismiss" onClick={() => answer.reset()}>
            ×
          </button>
        </div>
      ) : null}
      {echo && !answer.isError ? (
        <div className="sf-outcome-line" data-tone="ok" role="status">
          <span>{echo}</span>
          <button type="button" className="sf-icon-button" aria-label="Dismiss" onClick={() => setEcho(null)}>
            ×
          </button>
        </div>
      ) : null}
      {reshaped ? <OutcomeLine outcome={reshaped} onSuggest={(t) => put(t, false)} onDismiss={() => setReshaped(null)} /> : null}
      {dispatch.data ? (
        <OutcomeLine outcome={dispatch.data} onSuggest={(t) => put(t, false)} onDismiss={() => dispatch.reset()} />
      ) : null}
    </header>
  );
}
