/**
 * The top bar: one box to ask in, and the page-wide controls.
 *
 * A person asks in their own words; nothing here asks them to name a shape. An ask is written
 * as one row (`world_changed`) under the person's own key, and the walk takes it up from its
 * pool: nothing is dispatched and nothing is polled. What the walk does with it arrives as rows
 * the view names. A change to this interface, or an ask that was not recorded, speaks here in
 * one line.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { bindAsk, trySurfaceIntent, writeAsk, writeComplaint, type RowWrite } from "../api/client";
import { useUiView } from "../api/queries";
import { sendContribution } from "../api/participation";
import { onScreenReport, useOnScreen } from "../state/onScreen";
import type { DispatchOutcome } from "../api/types";
import { contributionContent } from "../lib/interaction";
import { reportExposureAct } from "../lib/exposure-reporter";
import { barePrefix, boxWords, presentationScope, readComplaint, readReplyPhrase, REPLY_PHRASES, type BoxContext, NEW_ASK } from "../lib/box";
import { useLiveControls } from "../state/liveControls";
import { useQuestions } from "../state/questions";
import { SignIn } from "./SignIn";
import { SESSION_KEY } from "../api/session";
import { useLimits } from "../state/limits";
import { Entries } from "./Reports";


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
    default:
      return null;
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
  openIssues,
  onToggleIssues,
  issuesOpen,
  complaintRegion = null,
  context = NEW_ASK,
  onSetAside,
}: {
  /** What the next message will be read as; the chip shows it. */
  context?: BoxContext;
  /** × on the chip: read the next message as a new ask instead. */
  onSetAside?: () => void;
  openIssues: number | null;
  onToggleIssues: () => void;
  issuesOpen: boolean;
  /** What a complaint typed now is about: the question open on the questions page; otherwise the surface. */
  complaintRegion?: string | null;
}): ReactNode {
  const [goal, setGoal] = useState("");
  const limits = useLimits();
  const boxRef = useRef<HTMLTextAreaElement | null>(null);
  const { paused, setPaused, intervalMs } = useLiveControls();
  const { recordReceipt } = useQuestions();
  const onScreen = useOnScreen();
  const [echo, setEcho] = useState<string | null>(null);
  // A send that failed, held against the echo that says so: that echo is drawn as a failure, with what
  // the system itself said, when it said something, on hover.
  const [failed, setFailed] = useState<{ echo: string; said?: string } | null>(null);
  // The ask just written, followed under its echo by the rows that cite it, while that echo stands.
  const [asked, setAsked] = useState<{ id: string; echo: string } | null>(null);
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
      // Recorded on the question, so the questions rail shows it answered.
      const q = args.ctx.question;
      const content = contributionContent({ panelId: q.id, revision: q.revision, askId: null, kind: outcome === "answered" ? "answer" : "dismiss", value: outcome === "answered" ? args.text.trim() : outcome });
      const receipt = await sendContribution({ ...content, response_id: crypto.randomUUID(), ...(phrase ? { classified_by: "box-phrase", classified_phrase: phrase.phrase } : {}) });
      recordReceipt(receipt);
      return { kind: "answered" as const, outcome };
    },
  });
  // An ask sent signed out: nothing was written, sign-in opens, and the ask goes once signed in.
  const [pendingAsk, setPendingAsk] = useState<string | null>(null);
  const [signInSignal, setSignInSignal] = useState(0);
  const queryClient = useQueryClient();
  // A complaint (16f-3): a row in the person's own words, about what is on screen, written as an ask is.
  const complain = useMutation({
    retry: false,
    mutationFn: (args: { text: string; about: string | null }): Promise<RowWrite> => writeComplaint(args.text, args.about),
  });
  // An ask: a presentation phrase changes this interface; anything else is written as the
  // person's ask. Signed out, nothing is written.
  const asking = useMutation({
    retry: false,
    mutationFn: async (text: string): Promise<{ kind: "reshaped"; change: DispatchOutcome } | { kind: "written"; got: RowWrite }> => {
      const change = await trySurfaceIntent(text, onScreenReport(onScreen));
      if (change) return { kind: "reshaped", change };
      return { kind: "written", got: await writeAsk(text) };
    },
  });
  const words = boxWords(context);
  const pending = asking.isPending || answer.isPending || complain.isPending;

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
    el.style.height = `${Math.min(el.scrollHeight, line * limits.boxLines + 16)}px`;
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
    if (readComplaint(text)) {
      asking.reset();
      setReshaped(null);
      complain.mutate(
        { text, about: complaintRegion },
        {
          onSuccess: (got) => {
            if (got.ok) {
              if (complaintRegion) reportExposureAct(complaintRegion, "complained");
              setEcho(`Complaint recorded${got.seq !== null ? ` (record #${got.seq})` : ""}.`);
              cleared();
              return;
            }
            if (got.signedOut) {
              // Kept in the box: it can be sent again once the person signs in with their key.
              void queryClient.invalidateQueries({ queryKey: SESSION_KEY });
              setSignInSignal((n) => n + 1);
              setEcho("Not sent yet: sign in with your key, then send it again.");
              return;
            }
            setEcho(`Not sent: ${got.reason}`);
            setFailed({ echo: `Not sent: ${got.reason}`, said: got.said });
          },
        },
      );
      return;
    }
    if (context.kind === "reply") {
      const ctx = context;
      asking.reset();
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
    ask(text);
  };

  const ask = (text: string): void => {
    asking.mutate(text, {
      onSuccess: (r) => {
        if (r.kind === "reshaped") {
          if (r.change.kind === "view") redraw(r.change.form);
          else setReshaped(r.change);
          if (r.change.kind !== "viewRefused") cleared();
          return;
        }
        const got = r.got;
        if (got.ok) {
          const said = `Asked${got.seq !== null ? ` (record #${got.seq})` : ""}. What the system does with it appears below.`;
          setEcho(said);
          setAsked(got.id ? { id: got.id, echo: said } : null);
          cleared();
          return;
        }
        if (got.signedOut) {
          // Kept in the box; it goes once the person signs in with their key.
          void queryClient.invalidateQueries({ queryKey: SESSION_KEY });
          setPendingAsk(text);
          setSignInSignal((n) => n + 1);
          setEcho("Not sent yet: sign in with your key, and your ask goes then.");
          return;
        }
        setEcho(`Not sent: ${got.reason}`);
        setFailed({ echo: `Not sent: ${got.reason}`, said: got.said });
      },
    });
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
          openSignal={signInSignal}
          onSignedIn={() => {
            if (pendingAsk) {
              const text = pendingAsk;
              setPendingAsk(null);
              ask(text);
            }
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
      </div>

      {asking.isError ? (
        <div className="sf-outcome-line" data-tone="error" role="status">
          <span>Not sent: {(asking.error as Error).message}</span>
          <button type="button" className="sf-icon-button" aria-label="Dismiss" onClick={() => asking.reset()}>
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
      {answer.isError ? (
        <div className="sf-outcome-line" data-tone="error" role="status">
          <span>Not delivered: {(answer.error as Error).message}</span>
          <button type="button" className="sf-icon-button" aria-label="Dismiss" onClick={() => answer.reset()}>
            ×
          </button>
        </div>
      ) : null}
      {echo && !answer.isError ? (
        <div className="sf-outcome-line" data-tone={failed?.echo === echo ? "error" : "ok"} role="status">
          <span title={failed?.echo === echo ? failed.said : undefined}>{echo}</span>
          <button type="button" className="sf-icon-button" aria-label="Dismiss" onClick={() => setEcho(null)}>
            ×
          </button>
        </div>
      ) : null}
      {asked && echo === asked.echo ? <AskFollow asked={asked} enabled={!paused} intervalMs={intervalMs} /> : null}
      {reshaped ? <OutcomeLine outcome={reshaped} onSuggest={(t) => put(t, false)} onDismiss={() => setReshaped(null)} /> : null}
    </header>
  );
}

/**
 * What follows an ask: the `ask` region's view, drawn as any region is, with the ask's own
 * row id bound where the view names it. What is read and how it is drawn is the view's.
 */
function AskFollow({ asked, enabled, intervalMs }: { asked: { id: string }; enabled: boolean; intervalMs: number }): ReactNode {
  const view = useUiView("ask", { enabled, intervalMs });
  if (!view.data) return null;
  const entries = view.data.entries.map((e) => ({ ...e, pointer: bindAsk(e.pointer, asked.id) }));
  return <Entries entries={entries} enabled={enabled} intervalMs={intervalMs} onOpenQuestion={() => undefined} />;
}
