// @interaction:exempt-file P3 — all question lists render an explicitly accepted snapshot; polling never splices rows into it
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { fetchQuestions, sendContribution, type Contribution, type Question, type ParticipationResponse } from "../api/participation";
import { planContent } from "../lib/ledger";
import { sortRuns } from "../lib/sort";
import { useLiveControls, useRegionFreeze } from "../state/liveControls";
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
  const visible = snapshot ?? [];
  const available = query.data ?? [];
  useEffect(() => {
    // First paint needs no confirmation. Subsequent arrivals are buffered.
    if (snapshot === null && query.data) {
      setSnapshot(query.data);
      const initial = sortRuns(query.data.map(question => ({ ...question, dispatchId: question.id, startedAtMs: question.createdAt })));
      setSelected(initial.find(question => !question.answered && !question.declined)?.id ?? initial[0]?.id ?? null);
    }
  }, [snapshot, query.data]);
  const changed = snapshot !== null && JSON.stringify(available) !== JSON.stringify(visible);
  const ordered = sortRuns(visible.map(question => ({ ...question, dispatchId: question.id, startedAtMs: question.createdAt })));
  const selectedId = selected ?? ordered[0]?.id;
  const waiting = visible.filter(question => !question.answered && !question.declined).length;
  function recordReceipt(receipt: ParticipationResponse): void {
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
    if (result.data && !result.isError) setSnapshot(result.data);
  }

  return (
    <section className="sf-region sf-participation" aria-labelledby="sf-participation-title" {...handlers}>
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
          {ordered.map(question => <button type="button" key={question.id} className="sf-question-link"
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
