// @interaction:exempt-file P3 — all question lists render an explicitly accepted snapshot; polling never splices rows into it
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { fetchQuestions, sendContribution, type Contribution, type Question, type ParticipationResponse } from "../api/participation";
import { planContent } from "../lib/ledger";
import { sortRuns } from "../lib/sort";
import { useLiveControls, useRegionFreeze } from "../state/liveControls";
import { reportExposureAct, reportExposureTick } from "../lib/exposure-reporter";
import { ComplainButton } from "./ComplainButton";
import { ContentRender } from "./ContentRender";
import { LiveControls } from "./LiveControls";

function contentText(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2) ?? "";
}

function QuestionCard({ incoming, onRecorded }: { incoming: Question; onRecorded: (receipt: ParticipationResponse) => void }): ReactNode {
  // Hold the exact question being answered. New versions require explicit review.
  const [question, setQuestion] = useState(incoming);
  const [text, setText] = useState("");
  const [format, setFormat] = useState("text");
  const [ask, setAsk] = useState("");
  const [error, setError] = useState("");
  const id = useId();
  const pending = useRef<{ signature: string; contribution: Contribution } | null>(null);
  const mutation = useMutation({ mutationFn: sendContribution, retry: false, onSuccess: onRecorded });
  const revised = incoming.revision !== question.revision;
  const currentResponses = incoming.responses;

  function submit(kind: "answer" | "dismiss"): void {
    setError("");
    let value: unknown = text;
    if (kind === "answer" && !text.trim()) { setError("Add your contribution before sending."); return; }
    if (kind === "answer" && format === "json" && text.trim()) {
      try { value = JSON.parse(text); }
      catch { setError("This is not valid JSON. Correct it or choose text; your draft is unchanged."); return; }
    }
    const content = {
      panel_id: question.id, panel_revision: question.revision,
      ...(kind === "answer" && ask ? { ask_id: ask } : {}), kind, value,
    };
    const signature = JSON.stringify(content);
    // An uncertain delivery can be retried without manufacturing another response.
    if (pending.current?.signature !== signature) {
      pending.current = { signature, contribution: { ...content, response_id: crypto.randomUUID() } };
    }
    mutation.mutate(pending.current.contribution);
  }

  return (
    <article className="sf-question-card" aria-labelledby={`${id}-title`}>
      <p className="sf-question-eyebrow">A question from the system</p>
      <h3 id={`${id}-title`}>{question.title}</h3>
      <div className="sf-question-content"><ContentRender plan={planContent("human_question", contentText(question.body), false)} /></div>
      {question.asks?.map(part => (
        <p key={part.id}><strong>{part.prompt}</strong>{part.choices?.length ? ` Options: ${part.choices.join("; ")}` : ""}</p>
      ))}
      {revised ? <div className="sf-warn">
        <p>The question has changed. Review the new version before responding. Your draft will be kept.</p>
        <button type="button" className="sf-button" onClick={() => {
          setQuestion(incoming); setAsk(""); mutation.reset(); setError(""); pending.current = null;
        }}>Review revised question</button>
      </div> : null}
      {incoming.answered || incoming.declined ? <p className="sf-note sf-question-receipt">
        {incoming.answered ? "An answer is recorded. You can add to it below." : "You declined this question. You can still respond if circumstances change."}
      </p> : null}
      <form onSubmit={event => { event.preventDefault(); submit("answer"); }}>
        {question.asks?.length ? <>
          <label className="sf-label" htmlFor={`${id}-part`}>Respond to</label>
          <select id={`${id}-part`} className="sf-select" value={ask} disabled={mutation.isPending} onChange={event => setAsk(event.target.value)}>
            <option value="">The whole question</option>
            {question.asks.map(part => <option key={part.id} value={part.id}>{part.prompt}</option>)}
          </select>
        </> : null}
        <label className="sf-label" htmlFor={`${id}-answer`}>Your contribution</label>
        <textarea id={`${id}-answer`} className="sf-textarea" value={text} disabled={mutation.isPending}
          placeholder="Share what you know, point to evidence, or explain what is missing."
          onChange={event => { setText(event.target.value); mutation.reset(); }} />
        <details className="sf-contribution-options">
          <summary>{format === "json" ? "Structured content selected" : "Send structured content"}</summary>
          <p className="sf-note">Use JSON to preserve a record, a list, a value, or a reference to other content. It is stored as supplied.</p>
          <label className="sf-label" htmlFor={`${id}-format`}>Contribution format</label>
          <select id={`${id}-format`} className="sf-select" value={format} disabled={mutation.isPending} onChange={event => { setFormat(event.target.value); mutation.reset(); }}>
            <option value="text">Text</option><option value="json">JSON</option>
          </select>
        </details>
        <p className="sf-note sf-muted">Shared with the system when you send. Unsent drafts stay in this page.</p>
        <div className="sf-participation-actions">
          <button type="submit" className="sf-button sf-button-primary" disabled={mutation.isPending || revised}>{mutation.isPending ? "Recording…" : "Send contribution"}</button>
          <button type="button" className="sf-button" disabled={mutation.isPending || revised} onClick={() => submit("dismiss")}>Decline to answer</button>
        </div>
      </form>
      <div role="status">
        {error ? <p className="sf-error">{error}</p> : null}
        {mutation.isError ? <p className="sf-error">{mutation.error.message} Your draft is kept. Refresh questions to check for changes; retry an uncertain delivery without editing to avoid a duplicate.</p> : null}
        {mutation.data ? <div className="sf-question-receipt">
          <strong>{mutation.data.kind === "dismiss" ? "Your decline is recorded." : "Your contribution is recorded."}</strong>
          <p>The requesting activity can read it. Whether it has used it is not yet known.</p>
          <details><summary>Delivery receipt</summary><p className="sf-note">{mutation.data.id} · question revision {mutation.data.panelRevision}. Storage is confirmed; consumption and learning are not.</p></details>
        </div> : null}
      </div>
      {/*
        * "complained" is one of the four distinct outcomes the exposure record
        * keeps apart, and it was previously unobservable per solicitation: the
        * only complaint control on the page is region-scoped ("the surface").
        * This one files against this solicitation's own id through the SAME
        * human-origin path (POST /api/feedback → uiFeedback → the shared
        * ui-feedback-<region>-<kind> gap keyspace). The reporter only WATCHES
        * it succeed; it never posts to that channel itself.
        */}
      <div className="sf-question-complain">
        <ComplainButton region={question.id} onFiled={() => reportExposureAct(question.id, "complained")} />
      </div>
      <details className="sf-question-history"><summary>Evidence and response history</summary>
        <p className="sf-note sf-muted">Question {question.id} · revision {question.revision}. The original content is preserved below.</p>
        <pre className="sf-verbatim">{contentText(question.body)}</pre>
        {currentResponses.length === 0 ? <p>No contributions in this snapshot.</p> : currentResponses.map(response => (
          <div key={response.id}>
            <p className="sf-note">{response.kind} · revision {response.panelRevision ?? 1} · {response.id}{response.askId ? ` · part ${response.askId}` : ""}</p>
            <pre className="sf-verbatim">{contentText(response.value)}</pre>
          </div>
        ))}
        {incoming.responses.some(r => (r.panelRevision ?? 1) !== question.revision) ? <p className="sf-note">Earlier revisions have separate contributions; they do not answer this version.</p> : null}
      </details>
    </article>
  );
}

export function ParticipationRegion(): ReactNode {
  const { paused, intervalMs } = useLiveControls();
  const { frozen, handlers } = useRegionFreeze();
  const query = useQuery({
    queryKey: ["humanQuestions"], queryFn: fetchQuestions,
    enabled: !paused && !frozen, refetchInterval: !paused && !frozen ? intervalMs : false,
    refetchOnWindowFocus: false, retry: false,
  });
  const [snapshot, setSnapshot] = useState<Question[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  // Exposure ticks are counted, not timed: this increments only where a
  // snapshot from the server is ACCEPTED for display (first paint below, and
  // refresh()). A receipt splicing into the local snapshot is not a new
  // presentation and must not inflate an exposure count.
  const [acceptedTicks, setAcceptedTicks] = useState(0);
  const regionRef = useRef<HTMLElement | null>(null);
  const visible = snapshot ?? [];
  const available = query.data ?? [];
  useEffect(() => {
    // First paint needs no confirmation. Subsequent arrivals are buffered.
    if (snapshot === null && query.data) {
      setSnapshot(query.data);
      const initial = sortRuns(query.data.map(question => ({ ...question, dispatchId: question.id, startedAtMs: question.createdAt })));
      setSelected(initial.find(question => !question.answered && !question.declined)?.id ?? initial[0]?.id ?? null);
      setAcceptedTicks(count => count + 1);
    }
  }, [snapshot, query.data]);
  // Measure AFTER the accepted snapshot has been committed to the DOM, so the
  // record describes boxes that exist. What is recorded is the intersection of
  // each row's box with the viewport box clipped by its scroll ancestors — the
  // strongest available claim, and not a claim that anyone looked at it.
  useEffect(() => {
    if (acceptedTicks === 0 || !regionRef.current) return;
    reportExposureTick(regionRef.current, snapshot?.length ?? 0);
  }, [acceptedTicks]);
  /**
   * "Review updates" must mean the server holds CONTENT this reader has not
   * accepted. Two things are therefore excluded from the comparison, each
   * measured to trip it on its own:
   *
   *  - `rank` / `because`. The server computes them on every read, and they move
   *    as a consequence of the READER'S OWN act: answering a question drops its
   *    unanswered weight, so the row sinks and its leading reason flips from
   *    "no answer recorded yet" to "you already answered it". Comparing them
   *    left the toolbar stuck on "Review updates" after every contribution,
   *    inviting a person to re-confirm their own answer.
   *  - ORDER. The buffer exists precisely so the list does not reorder under
   *    someone who is reading it, and this region sorts by `createdAt` anyway
   *    (lib/sort.ts rule P5), so an order-only change is not news to confirm.
   *
   * What still fires: a new question (a new id), a revised one (`revision`), and
   * any change to answers, declines or asks — the things a reader must actually
   * look at again. STATED SO IT CAN BE VETOED: a learner rewriting the
   * importance weights with no content change will no longer offer "Review
   * updates"; the next accepted snapshot picks the new order up.
   */
  const contentOf = (questions: readonly Question[]): string =>
    JSON.stringify(
      [...questions]
        .sort((a, b) => a.id.localeCompare(b.id))
        .map(question => {
          const copy: Record<string, unknown> = { ...question };
          delete copy["rank"];
          delete copy["because"];
          return copy;
        }),
    );
  const changed = snapshot !== null && contentOf(available) !== contentOf(visible);
  // ORDER BY IMPORTANCE WHEN THE SERVER RANKED, RECENCY ONLY AS A FALLBACK.
  //
  // This line used to call sortRuns unconditionally, which orders by
  // startedAtMs (= createdAt), newest first — so `rank` arrived from the ranker
  // and was then discarded, and its only remaining effect on a human was a
  // data attribute they cannot see. Measured before this change: the rank-1 row
  // (a 22-day-old escalation) sat at DOM position 12 of 12 and was never
  // visible, while the three rows actually on screen were ranks 10, 8 and 5.
  //
  // That is worse than a cosmetic ordering miss, because the exposure records
  // are written from what is ON SCREEN. Learning from a recency-ordered slice
  // while believing it learned from an importance-ordered one is the
  // self-confirming loop this feature has to avoid: the weights would be
  // conditioned on createdAt no matter what the ranker said.
  //
  // Fallback is deliberate rather than defensive: a server that did not rank
  // (an older build, or a ranking that failed) must still produce a usable
  // list, and recency is the honest ordering to fall back TO — but the
  // exposure record then reports rank_source "dom_order" rather than claiming
  // an importance order it did not have.
  const withSortKeys = visible.map(question => ({ ...question, dispatchId: question.id, startedAtMs: question.createdAt }));
  const everyRowRanked = withSortKeys.length > 0
    && withSortKeys.every(question => typeof question.rank === "number" && Number.isFinite(question.rank));
  const ordered = everyRowRanked
    ? [...withSortKeys].sort((a, b) =>
        (a.rank as number) - (b.rank as number)
        // Same unique tiebreaker every comparator in this surface ends on, so
        // the list cannot reorder under a reader when ranks tie.
        || (a.dispatchId < b.dispatchId ? -1 : a.dispatchId > b.dispatchId ? 1 : 0))
    : sortRuns(withSortKeys);
  const selectedId = selected ?? ordered[0]?.id;
  const waiting = visible.filter(question => !question.answered && !question.declined).length;
  function recordReceipt(receipt: ParticipationResponse): void {
    // Answered and declined stay DISTINCT, and an ask-level act keeps its
    // ask_id rather than being folded into a panel-level verdict — the store
    // reads `declined` only when there is no ask id, so a per-ask decline is
    // written there and never read; the exposure record keeps both.
    reportExposureAct(receipt.panelId, receipt.kind === "dismiss" ? "declined" : "answered", receipt.askId);
    setSnapshot(previous => previous?.map(question => {
      if (question.id !== receipt.panelId || question.revision !== receipt.panelRevision) return question;
      const responses = [...question.responses.filter(response => response.id !== receipt.id), receipt];
      const current = responses.filter(response => (response.panelRevision ?? 1) === question.revision);
      const answers = current.filter(response => response.kind === "answer");
      return { ...question, responses, answers,
        answered: answers.some(response => !response.askId) || Boolean(question.asks?.length && question.asks.every(part => answers.some(response => response.askId === part.id))),
        declined: current.some(response => response.kind === "dismiss" && !response.askId),
      };
    }) ?? null);
    void query.refetch();
  }
  async function refresh(): Promise<void> {
    const result = await query.refetch();
    if (result.data && !result.isError) {
      setSnapshot(result.data);
      setAcceptedTicks(count => count + 1);
    }
  }

  return (
    <section ref={regionRef} className="sf-region sf-participation" aria-labelledby="sf-participation-title" {...handlers}>
      <div className="sf-region-head">
        <div className="sf-participation-heading">
          <h2 className="sf-region-title" id="sf-participation-title">Questions for you</h2>
          <span className="sf-participation-count">{snapshot === null ? "Checking for requests" : `${waiting} awaiting your perspective`}</span>
        </div>
        <details className="sf-participation-updates"><summary>Update settings</summary><LiveControls frozen={frozen} regionName="participation" /></details>
      </div>
      <div className="sf-participation-toolbar">
        <p className="sf-note">Bring context, evidence, or a different perspective to work in progress.</p>
        <button type="button" className="sf-button sf-button-quiet" disabled={query.isFetching} onClick={() => { void refresh(); }}>
          {query.isFetching ? "Checking…" : changed ? "Review updates" : "Refresh questions"}
        </button>
      </div>
      {query.isError ? <p className="sf-error">Questions could not be refreshed: {query.error.message}. The last view and your drafts are retained.</p> : null}
      {query.isPending ? <p className="sf-empty">Checking for questions…</p> : null}
      {!query.isPending && !query.isError && visible.length === 0 ? <p className="sf-empty sf-participation-empty">No questions need your attention here. You can start work by stating a goal above.</p> : null}
      {visible.length ? <div className="sf-participation-workspace">
        <nav className="sf-question-list" aria-label="System questions">
          {/*
            * The list row is the measured element, and the only one carrying
            * `data-solicitation-id`: it is the enumerable slice — the thing a
            * person is actually offered when 425 solicitations arrive at once.
            * `data-rank` / `data-rank-explanation` are the ranking renderer's
            * to publish here; while they are absent the record says
            * rank_source "dom_order" and explanation null rather than
            * inventing one.
            */}
          {ordered.map(question => <button type="button" key={question.id} className="sf-question-link"
            data-solicitation-id={question.id} data-exposure-role="list_row"
            {...(typeof question.rank === "number" ? { "data-rank": String(question.rank) } : {})}
            {...(question.because?.[0] ? { "data-rank-explanation": question.because[0] } : {})}
            aria-current={selectedId === question.id ? "true" : undefined} onClick={() => setSelected(question.id)}>
            <span>{question.title}</span>
            <small>{question.answered ? "Response recorded" : question.declined ? "Declined" : "Awaiting your input"}</small>
          </button>)}
        </nav>
        <div className="sf-participation-detail">
          {ordered.map(question => <div key={question.id} hidden={selectedId !== question.id}>
            <QuestionCard incoming={question} onRecorded={recordReceipt} />
          </div>)}
        </div>
      </div> : null}
    </section>
  );
}
