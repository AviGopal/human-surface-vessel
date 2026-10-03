/**
 * The run as a chain: each output with the impulses it consumed under it, then
 * what was produced and not used. Content is whatever the record holds — a
 * preview of up to 2,000 characters — and says so; the full content cannot be
 * read by reference until goal-host serves it (coordinator ask C1, gated on
 * route authentication).
 */

import type { ReactNode } from "react";
import type { GoalWalkState, RouteAround } from "../api/types";
import { buildChains, inputsOf, isSeed, type ChainNode, type RunChains } from "../lib/chain";
import { creditFor, readCredit, type CreditRow, type RunCredit } from "../lib/credit";
import { fromProvenance } from "../lib/content";
import { Rendered } from "./Rendered";

const MAX_DEPTH = 4;

function count(n: number): string {
  return n.toLocaleString("en-US");
}

function producerLabel(n: ChainNode): string | null {
  if (!n.producedBy || n.producedBy === "goal-host-walk") return null;
  return n.producedBy;
}

function deltaText(r: CreditRow): string {
  const parts: string[] = [];
  if (r.dAlpha) parts.push(`+${r.dAlpha}α`);
  if (r.dBeta) parts.push(`+${r.dBeta}β`);
  return parts.join(" ");
}

/** The credit the node's producer received in this run, shown where the reviewer reads the node. */
function CreditBadge({ row }: { row: CreditRow | null }): ReactNode {
  if (!row) return null;
  return (
    <span className="sf-credit-badge" data-credit={row.dAlpha > 0 ? "credited" : "penalised"} title={row.templateId}>
      {deltaText(row)}
    </span>
  );
}

function NodeContent({ n, density, credit }: { n: ChainNode; density: "full" | "inline"; credit: RunCredit | null }): ReactNode {
  const content = fromProvenance(n.raw);
  if (!content) return null;
  return (
    <Rendered
      content={content}
      density={density}
      region="run_chain"
      extraHeader={
        <>
          {n.producerExecutionId ? <span className="sf-muted sf-mono">{n.producerExecutionId}</span> : null}
          <CreditBadge row={creditFor(n.producedBy, credit)} />
        </>
      }
    />
  );
}

/** A collapsed input: one line until opened. */
function InputRow({ n, chains, depth, seen, credit }: { n: ChainNode; chains: RunChains; depth: number; seen: ReadonlySet<string>; credit: RunCredit | null }): ReactNode {
  const content = fromProvenance(n.raw);
  const producer = producerLabel(n);
  return (
    <li className="sf-chain-input">
      <details>
        <summary>
          <span className="sf-shape-badge">{n.shape}</span>
          {isSeed(n) ? <span className="sf-muted">request</span> : producer ? <span className="sf-mono sf-muted">{producer}</span> : null}
          <span className="sf-muted">{n.chars > 0 ? `${count(n.chars)} chars` : "no content"}</span>
          <CreditBadge row={creditFor(n.producedBy, credit)} />
          {content ? <Rendered content={content} density="row" /> : null}
        </summary>
        <div className="sf-chain-input-body">
          <NodeContent n={n} density="inline" credit={credit} />
          <Inputs n={n} chains={chains} depth={depth + 1} seen={seen} credit={credit} />
        </div>
      </details>
    </li>
  );
}

function Inputs({ n, chains, depth, seen, credit }: { n: ChainNode; chains: RunChains; depth: number; seen: ReadonlySet<string>; credit: RunCredit | null }): ReactNode {
  if (n.consumedIds.length === 0 || depth > MAX_DEPTH || seen.has(n.id)) return null;
  const { inputs, missing } = inputsOf(n, chains);
  const next = new Set(seen).add(n.id);
  return (
    <div className="sf-chain-inputs">
      <p className="sf-chain-label">consumed</p>
      <ul>
        {inputs.map((i) => (
          <InputRow key={i.id} n={i} chains={chains} depth={depth} seen={next} credit={credit} />
        ))}
      </ul>
      {missing.length > 0 ? (
        <p className="sf-muted sf-note">{missing.length} missing</p>
      ) : null}
    </div>
  );
}

function RouteArounds({ items }: { items: readonly RouteAround[] }): ReactNode {
  if (items.length === 0) return null;
  return (
    <details className="sf-chain-routes">
      <summary>Stalls · {items.length}</summary>
      <ol>
        {items.map((r, i) => (
          <li key={`${r.at ?? i}`}>
            {r.missing_producer && r.missing_producer.length > 0 ? (
              <>
                missing <span className="sf-mono">{r.missing_producer.join(", ")}</span>
              </>
            ) : (
              r.termination ?? "stalled"
            )}
            {r.route_taken ? <span className="sf-muted"> → {r.route_taken}</span> : null}
            {r.failed_producers && r.failed_producers.length > 0 ? (
              <span className="sf-muted"> · {r.failed_producers.length} failed</span>
            ) : null}
          </li>
        ))}
      </ol>
    </details>
  );
}

/** What the run taught the learner, from the record's learning sink. Nothing when it taught nothing. */
function CreditSection({ credit }: { credit: RunCredit | null }): ReactNode {
  if (!credit || credit.rows.length === 0) return null;
  const credited = credit.rows.filter((r) => r.dAlpha > 0).length;
  const penalised = credit.rows.length - credited;
  return (
    <details className="sf-chain-credit" open={credited > 0}>
      <summary>
        Credit · {credited} credited · {penalised} penalised
        {credit.goalPathRecorded === true ? <span className="sf-muted"> · path recorded</span> : null}
        {credit.gapsFiled > 0 ? <span className="sf-muted"> · {credit.gapsFiled} gaps filed</span> : null}
      </summary>
      <ul>
        {credit.rows.map((r) => (
          <li key={r.templateId}>
            <span className="sf-mono">{r.templateId}</span> <CreditBadge row={r} />
          </li>
        ))}
      </ul>
    </details>
  );
}

/**
 * `blind` is for calibration grading: what the run produced, with nothing that
 * carries the system's own verdict on it (credit, stalls).
 */
export function Chain({ walk, blind = false }: { walk: GoalWalkState; blind?: boolean }): ReactNode {
  const chains = buildChains(walk);
  const credit = blind ? null : readCredit(walk.learning);
  const routes = blind ? [] : (walk.routeArounds ?? []);
  const terminal = walk.status !== "running";

  if (!chains.retained) {
    return terminal ? (
      <section className="sf-view-section sf-chain" aria-label="Outputs">
        <h3 className="sf-view-label">Outputs</h3>
        <p className="sf-note sf-muted" title="the server keeps its newest 100 runs">Not retained</p>
        <CreditSection credit={credit} />
        <RouteArounds items={routes} />
      </section>
    ) : null;
  }

  const lead = chains.outputs;
  return (
    <section className="sf-view-section sf-chain" aria-label="Outputs">
      <h3 className="sf-view-label">Outputs</h3>

      {lead.map((n) => (
        <article key={n.id} className="sf-chain-output">
          <NodeContent n={n} density="full" credit={credit} />
          <Inputs n={n} chains={chains} depth={0} seen={new Set()} credit={credit} />
        </article>
      ))}

      {chains.unused.length > 0 ? (
        <details className="sf-chain-unused" open={lead.length === 0}>
          <summary>
            {lead.length === 0 ? "Produced" : "Unused"} · {chains.unused.length}
          </summary>
          <ul>
            {chains.unused.map((n) => (
              <InputRow key={n.id} n={n} chains={chains} depth={MAX_DEPTH} seen={new Set()} credit={credit} />
            ))}
          </ul>
        </details>
      ) : null}

      <CreditSection credit={credit} />
      <RouteArounds items={routes} />
    </section>
  );
}
