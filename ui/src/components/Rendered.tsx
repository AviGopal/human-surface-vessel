/**
 * <Rendered> — the one way content reaches the page.
 *
 * Every caller hands over a `Content` and a density; this component plans it
 * (pin → learned → unwrap → heuristic), frames it the same way everywhere
 * (shape, source, how complete it is, copy), draws it with the form's renderer,
 * and records the decision. A renderer that throws falls back to the verbatim
 * text inside the same frame, so a rendering bug can never hide content.
 *
 * Densities change depth and clamping, never the form:
 *   row    — one line, no frame, no recorded decision (a clamp is not a reading).
 *   inline — compact frame, full body.
 *   full   — full frame and body.
 */

import { sendObservation } from "../api/exposure";
import { Component, useEffect, useRef, useState, type ErrorInfo, type ReactNode } from "react";
import { useRenderPolicy } from "../api/queries";
import { useQuery } from "@tanstack/react-query";
import { fetchWalkOutput } from "../api/client";
import { useSession } from "../api/session";
import { contentText, type Content } from "../lib/content";
import { CUT_KEY, findMarkup, planContent, type RenderPlan } from "../lib/ledger";
import { formatChars } from "../lib/time";
import { useLiveControls } from "../state/liveControls";
import { useOnScreenRegistrar } from "../state/onScreen";
import { ContentRender, CopyButton } from "./ContentRender";
import { FormDecisionRecorder } from "./FormDecisionRecorder";

export type Density = "row" | "inline" | "full";

export class RenderBoundary extends Component<{ text: string; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[rendered] form renderer threw; showing verbatim", error, info.componentStack);
  }
  override render(): ReactNode {
    if (this.state.failed) return <pre className="sf-verbatim" data-fallback="true">{this.props.text}</pre>;
    return this.props.children;
  }
}

/**
 * How much of a page is drawn. The page frame draws what the run kept, and goal-host
 * keeps a preview of each output, so a real site is usually cut near its top; a cut
 * page must never read as whole. Decided only by the run's own report (truncated,
 * and the kept and total sizes); without that report it says so, never "whole".
 */
function PageCompleteness({ content }: { content: Content }): ReactNode {
  const size = content.size;
  if (content.state === "truncated") {
    return (
      <p className="sf-page-cut">
        {size ? `Cut off: the first ${formatChars(size.shown)} of ${formatChars(size.total)} characters` : "Cut off"}
      </p>
    );
  }
  if (content.state === "full" && size && size.shown >= size.total) return null;
  return <p className="sf-page-cut sf-muted">Completeness unknown</p>;
}

function completeness(c: Content): ReactNode {
  switch (c.state) {
    case "truncated":
      return c.size ? (
        <span className="sf-cut">
          first {formatChars(c.size.shown)} of {formatChars(c.size.total)} chars
        </span>
      ) : (
        <span className="sf-cut">preview</span>
      );
    case "streaming":
      return <span className="sf-streaming">● streaming{c.size ? ` · ${formatChars(c.size.shown)} chars` : ""}</span>;
    case "closed":
      return <span className="sf-muted">stream closed{c.size ? ` · ${formatChars(c.size.shown)} chars` : ""}</span>;
    case "failed":
      return <span className="sf-failure-chip">failed — showing what arrived</span>;
    case "absent":
      return <span className="sf-muted">no content</span>;
    default:
      return null;
  }
}

/** One line for the row density: the first thing a reader would want to see. */
export function summarizeLine(plan: RenderPlan): string {
  const t = plan.text.trim();
  if (plan.form === "record") {
    try {
      const v: unknown = JSON.parse(t);
      if (Array.isArray(v)) return `${v.length} item${v.length === 1 ? "" : "s"}`;
      if (v && typeof v === "object") {
        return Object.entries(v as Record<string, unknown>)
          .filter(([k]) => k !== CUT_KEY)
          .slice(0, 4)
          .map(([k, val]) => `${k} ${val !== null && typeof val === "object" ? "{…}" : String(val)}`)
          .join(" · ");
      }
    } catch {
      /* fall through to the first line */
    }
  }
  if (plan.form === "scalar" && plan.label) return `${plan.label} ${t}`;
  return t.split("\n").find((l) => l.trim().length > 0)?.replace(/^#+\s*/, "") ?? "";
}

/**
 * The plan `<Rendered>` draws for this content under this policy. Exported so a
 * caller that must NAME the form elsewhere (a question row, for the form
 * learner) names exactly the form the card draws — one function, not two.
 */
export function planFor(
  content: Content,
  policy: { formByShape?: Readonly<Record<string, string>>; learnedFormByShape?: Readonly<Record<string, string>> } | undefined,
): RenderPlan {
  const text = contentText(content);
  return content.state === "absent" || text.trim().length === 0
    ? ({ form: "empty", text: "", decidedBy: "empty_preview" } as RenderPlan)
    : planContent(content.shape, text, content.state === "truncated", policy?.formByShape, policy?.learnedFormByShape);
}

export function Rendered({
  content,
  density = "full",
  region,
  header = true,
  extraHeader,
  lead = false,
  dispatchId,
}: {
  content: Content;
  density?: Density;
  /** Form-decision region label; omit only for content that is not an impulse reading. */
  region?: string;
  /** Draw the header strip. Off for content whose caller already names it. */
  header?: boolean;
  /** Caller-specific facts that belong in the header (e.g. a step's producer). */
  extraHeader?: ReactNode;
  /**
   * The run's lead answer: what "this" means in the one box ("show this as a
   * table"). A choice made there redraws this payload at once and is recorded as
   * a `form_choice` observation the form learner reads (src/form-learn.ts),
   * previewed through the same path a pin or a learned form takes.
   */
  lead?: boolean;
  /** The run this content belongs to, when the caller knows it: recorded with the form decision. */
  dispatchId?: string;
}): ReactNode {
  const { paused, intervalMs } = useLiveControls();
  const policy = useRenderPolicy({ enabled: !paused, intervalMs }).data;
  // A cut output whose whole can be read: at once for a page (the person asked to see
  // the page), on "Show all" for anything else. Until it arrives, or if it can't be read,
  // the preview is drawn and marked as cut.
  const [askedAll, setAskedAll] = useState(false);
  // Read only for a signed-in person (qa ruling 10-24); anyone else keeps the marked preview.
  const signedIn = useSession().data?.signedIn === true;
  const whole = content.state === "truncated" && signedIn ? content.whole : undefined;
  const wantWhole = whole !== undefined && (askedAll || planFor(content, policy).form === "page");
  const read = useQuery({
    queryKey: ["walkOutput", whole?.dispatchId, whole?.impulseId],
    queryFn: () => fetchWalkOutput(whole!.dispatchId, whole!.impulseId),
    enabled: wantWhole,
    staleTime: Infinity,
    retry: false,
  });
  const full = read.data;
  if (full && typeof full.content === "string" && full.content.length > 0) {
    content = {
      ...content,
      body: full.content,
      state: full.truncated ? "truncated" : "full",
      size: { shown: full.content.length, total: typeof full.chars === "number" ? full.chars : full.content.length },
    };
  }
  const text = contentText(content);
  const truncated = content.state === "truncated";
  const [chosen, setChosen] = useState<string | null>(null);
  const planned = planFor(content, policy);
  const plan = chosen
    ? planFor(content, { ...(policy ?? {}), formByShape: { ...(policy?.formByShape ?? {}), [content.shape]: chosen } })
    : planned;
  const choose = (form: string, origin: "box"): void => {
    if (form === plan.form) return;
    sendObservation({
      obs_type: "form_choice",
      visibility: "operator_only",
      shape: content.shape,
      form_from: plan.form,
      form_to: form,
      ...(region ? { region } : {}),
      origin,
    });
    setChosen(form);
  };
  // The lead answer is what the box's "this" means. The latest `choose` is read
  // through a ref, so the registration follows the drawn form, not every render.
  const register = useOnScreenRegistrar();
  const chooseRef = useRef(choose);
  chooseRef.current = choose;
  const markup = findMarkup(text) !== null;
  useEffect(() => {
    if (!lead || !register) return;
    register({ shape: content.shape, form: plan.form, markup, region: region ?? null, choose: (f, o) => chooseRef.current(f, o) });
    return () => register(null);
  }, [lead, register, content.shape, plan.form, markup, region]);

  if (density === "row") {
    return (
      <span className="sf-rendered-row" data-form={plan.form} title={text.slice(0, 600)}>
        {summarizeLine(plan) || <span className="sf-muted">{content.shape}</span>}
      </span>
    );
  }

  const producedBy = content.provenance?.producedBy;
  const source = content.provenance?.source;
  const showSource = source && !text.includes(source);

  return (
    <div className="sf-rendered" data-density={density} data-form={plan.form} data-state={content.state}>
      {header ? (
        <div className="sf-rendered-head">
          <span className="sf-shape-badge">{content.shape}</span>
          {showSource ? <span className="sf-rendered-source">{source}</span> : null}
          {producedBy && producedBy !== "goal-host-walk" ? (
            <span className="sf-rendered-source sf-mono">{producedBy}</span>
          ) : null}
          {extraHeader}
          <span className="sf-rendered-head-right">
            {completeness(content)}
            {content.state === "truncated" && whole !== undefined && !read.isError ? (
              <button type="button" className="sf-link-button" disabled={read.isFetching} onClick={() => setAskedAll(true)}>
                Show all
              </button>
            ) : null}
            {density === "full" && plan.text.trim().length > 0 && plan.form !== "scalar" ? (
              <CopyButton text={plan.text} what={content.shape} />
            ) : null}
          </span>
        </div>
      ) : null}
      {plan.form === "empty" && content.state === "absent" ? null : (
        <div className="sf-rendered-body">
          <RenderBoundary text={text}>
            <ContentRender plan={plan} />
          </RenderBoundary>
          {plan.form === "page" ? <PageCompleteness content={content} /> : null}
        </div>
      )}
      {region ? (
        <FormDecisionRecorder
          shape={content.shape}
          plan={plan}
          truncated={truncated}
          policyRevision={policy?.revision ?? null}
          region={region}
          {...(dispatchId ? { dispatchId } : {})}
        />
      ) : null}
    </div>
  );
}

