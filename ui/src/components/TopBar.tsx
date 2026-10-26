/**
 * The top bar: one box to ask in, and the page-wide controls.
 *
 * A human sends goals in natural language; nothing here asks them to name a
 * shape. An accepted send opens its run in the main pane — the run IS the
 * outcome, so there is no separate note about it. Only an outcome with no run
 * to open (refused, draining, rejected, or a change to this interface) speaks
 * here, in one line.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { injectContext, trySurfaceIntent } from "../api/client";
import { useBoxTarget } from "../state/boxTarget";
import { onScreenReport, useOnScreen } from "../state/onScreen";
import { injectPayload } from "../lib/interaction";
import { useDispatchGoal, useSubmitGrade } from "../api/queries";
import type { DispatchOutcome } from "../api/types";
import { complaintPayload } from "../lib/interaction";
import { reportExposureAct } from "../lib/exposure-reporter";
import { barePrefix, boxWords, presentationScope, readAs, readComplaint, readReplyPhrase, readVerdict, REPLY_PHRASES, type BoxContext, NEW_ASK } from "../lib/box";
import { useLiveControls } from "../state/liveControls";
import { useQuestions } from "../state/questions";
import { answerRunQuestion } from "./RunQuestion";
import { StarterChips } from "./StarterChips";
import { SignIn } from "./SignIn";
import { useSession } from "../api/session";

const MAX_BOX_LINES = 8;

/** The echo for a reply delivered to a waiting run. */
const REPLY_ECHO: Readonly<Record<string, string>> = { answered: "Answer", declined: "Declined", insufficient_context: "Need more" };

/** The word the echo uses for a form the box redrew the answer in. */
const FORM_WORD: Readonly<Record<string, string>> = { rows: "table", record: "fields", text: "text", prose: "prose", page: "page", terminal: "terminal", diff: "diff", scalar: "value" };

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
    case "view":
      return null;
    case "viewRefused":
      tone = "warn";
      body = <>{outcome.reason}</>;
      break;
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
  complaintRegion = null,
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
  /** What a complaint typed now is about: the question open on the questions page; otherwise the surface. */
  complaintRegion?: string | null;
}): ReactNode {
  const [goal, setGoal] = useState("");
  const [focused, setFocused] = useState(false);
  const boxRef = useRef<HTMLTextAreaElement | null>(null);
  const dispatch = useDispatchGoal();
  const { paused, setPaused } = useLiveControls();
  const { recordReceipt } = useQuestions();
  const onScreen = useOnScreen();
  const [echo, setEcho] = useState<string | null>(null);
  const [reshaped, setReshaped] = useState<DispatchOutcome | null>(null);
  const answer = useMutation({
    retry: false,
    // A presentation phrase is read as one in any context: checked before the text
    // is taken as the run's answer, so "show this as a table" never reaches the run.
    mutationFn: async (args: { ctx: Extract<BoxContext, { kind: "reply" }>; text: string }) => {
      const change = await trySurfaceIntent(args.text, onScreenReport(onScreen));
      if (change) return { kind: "reshaped" as const, change };
      // "not now" and "need more", exactly, are the replies offered beside the box.
      const phrase = readReplyPhrase(args.text);
      const outcome = phrase?.outcome ?? "answered";
      const receipt = await answerRunQuestion(args.ctx.question, outcome, args.text, phrase ? { by: "box-phrase", phrase: phrase.phrase } : undefined);
      recordReceipt(receipt);
      return { kind: "answered" as const, outcome };
    },
  });
  const boxTarget = useBoxTarget();
  const supply = useMutation({
    retry: false,
    mutationFn: (args: { dispatchId: string; shape: string; text: string }) =>
      injectContext(injectPayload({ dispatchId: args.dispatchId, shape: args.shape, content: args.text })),
  });
  const grade = useSubmitGrade();
  const session = useSession().data;
  // A verdict given while signed out, where sign-in is offered: recorded as the person's once they sign in.
  const [pendingVerdict, setPendingVerdict] = useState<Parameters<typeof grade.mutate>[0] | null>(null);
  const queryClient = useQueryClient();
  // A complaint (16f-3): the same human_reported gap the form filed, about what is on screen.
  const complain = useMutation({
    retry: false,
    mutationFn: async (args: { kind: NonNullable<ReturnType<typeof readComplaint>>; region: string }) => {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(complaintPayload({ region: args.region, kind: args.kind.kind, text: args.kind.text })),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    },
  });
  const words = boxWords(context);
  const pending = dispatch.isPending || answer.isPending || supply.isPending || grade.isPending || complain.isPending;

  // The box carries what "Show as" did: the answer on screen redraws, and the
  // choice is recorded from the box, as a click on it was.
  const redraw = (form: string): void => {
    onScreen?.choose(form, "box");
    setEcho(`Display: ${FORM_WORD[form] ?? form}`);
    window.requestAnimationFrame(() => fit(boxRef.current));
    setGoal("");
  };

  // A chip elsewhere on the page (the Issues drawer, the questions page) fills the box.
  useEffect(() => {
    const onFill = (e: Event): void => put(String((e as CustomEvent).detail ?? ""), false);
    window.addEventListener("sf:fill-box", onFill);
    return () => window.removeEventListener("sf:fill-box", onFill);
  });

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
    // A complaint's prefix alone says nothing yet: it stays in the box, and nothing is sent.
    const bare = barePrefix(text);
    if (bare) {
      setEcho(bare === "wrong" ? "Say what's wrong" : `Say what's ${bare}`);
      return;
    }
    // An explicit complaint is a complaint in every context, never an answer or an ask.
    const complaint = readComplaint(text);
    if (complaint) {
      const region = complaintRegion ?? "the surface";
      dispatch.reset();
      setReshaped(null);
      complain.mutate(
        { kind: complaint, region },
        {
          onSuccess: () => {
            if (complaintRegion) reportExposureAct(complaintRegion, "complained");
            void queryClient.invalidateQueries({ queryKey: ["interfaceGaps"] });
            setEcho("Interface issue");
            cleared();
          },
        },
      );
      return;
    }
    if (context.kind === "supply") {
      const ctx = context;
      dispatch.reset();
      setReshaped(null);
      supply.mutate(
        { dispatchId: ctx.dispatchId, shape: ctx.shape, text },
        {
          onSuccess: () => {
            setEcho(`${readAs(ctx)} · added to the run`);
            boxTarget?.markSent({ dispatchId: ctx.dispatchId, shape: ctx.shape });
            boxTarget?.choose(null);
            cleared();
          },
        },
      );
      return;
    }
    if (context.kind === "reply") {
      const ctx = context;
      dispatch.reset();
      setReshaped(null);
      answer.mutate(
        { ctx, text },
        {
          onSuccess: (r) => {
            if (r.kind === "reshaped" && r.change.kind === "view") {
              redraw(r.change.form);
            } else if (r.kind === "reshaped") {
              setEcho(null);
              setReshaped(r.change);
            } else {
              setEcho(REPLY_ECHO[r.outcome] ?? "Answer");
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
    // A verdict on the finished run on screen, when the message is one of the exact
    // verdict phrases. The surface keeps it on the run whatever the corpus answers.
    const read = context.outcome ? readVerdict(text) : null;
    const verdict = read?.verdict ?? null;
    if (context.outcome && verdict) {
      const o = context.outcome;
      const said = verdict === "achieved" ? "reached" : "not reached";
      const submission = { executionId: o.executionId, goal: o.goal, verdict, notes: read?.notes ?? text, dispatchId: o.dispatchId, judgeReached: o.judgeReached, ...(o.about ? { about: o.about } : {}) };
      const signedOut = session?.available === true && !session.signedIn;
      const settle = (corpus: boolean): void => {
        if (!corpus && signedOut) setPendingVerdict(submission);
        setEcho(
          `Read as your verdict on this run: ${said} · ` +
            (corpus ? (session?.signedIn ? "recorded as yours" : "kept on the run") : signedOut ? "kept on the run; sign in to record it as yours" : "kept on the run; the learning corpus didn't take it yet"),
        );
        cleared();
      };
      grade.mutate(submission, { onSuccess: () => settle(true), onError: () => settle(false) });
      return;
    }
    dispatch.mutate(
      { goal: text, operator: "human-surface", tags: ["surface:do-anything"], onScreen: onScreenReport(onScreen) },
      {
        onSuccess: (outcome) => {
          if (outcome.kind === "view") {
            dispatch.reset();
            redraw(outcome.form);
            return;
          }
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
          {context.kind === "supply" && boxTarget ? (
            <button type="button" className="sf-icon-button" aria-label="Ask something new instead" onClick={() => boxTarget.choose(null)}>
              ×
            </button>
          ) : null}
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
          {goal.trim().length === 0 && context.kind === "reply" ? (
            // The replies a waiting run can take besides an answer. They fill the box; they never send.
            <div className="sf-ask-suggest" onMouseDown={(e) => e.preventDefault()}>
              {Object.keys(REPLY_PHRASES).map((p) => (
                <button key={p} type="button" className="sf-chip" onClick={() => put(p, false)}>
                  {p}
                </button>
              ))}
            </div>
          ) : null}
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
        <SignIn
          onSignedIn={() => {
            if (!pendingVerdict) return;
            const said = pendingVerdict.verdict === "achieved" ? "reached" : "not reached";
            grade.mutate(pendingVerdict, {
              onSuccess: () => setEcho(`Your verdict on that run: ${said} · recorded as yours`),
              onError: (e) => setEcho(`Your verdict on that run: ${said} · kept on the run; not recorded: ${(e as Error).message}`),
            });
            setPendingVerdict(null);
          }}
        />
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
      {complain.isError ? (
        <div className="sf-outcome-line" data-tone="error" role="status">
          <span>Not filed: {(complain.error as Error).message}</span>
          <button type="button" className="sf-icon-button" aria-label="Dismiss" onClick={() => complain.reset()}>
            ×
          </button>
        </div>
      ) : null}
      {supply.isError ? (
        <div className="sf-outcome-line" data-tone="error" role="status">
          <span>Not added: {(supply.error as Error).message}</span>
          <button type="button" className="sf-icon-button" aria-label="Dismiss" onClick={() => supply.reset()}>
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
      {echo && !answer.isError && !supply.isError ? (
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
