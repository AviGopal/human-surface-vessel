/**
 * Rule P9, and it is the single most important renderer in this surface.
 *
 * The shape vocabulary is OPEN — hundreds of shapes, learned by observation
 * rather than declared, and ragged enough that whole prose sentences have been
 * registered as shape names. No renderer-per-shape is possible. Content,
 * however, arrives in a small CLOSED set of forms.
 *
 * So: dispatch on the form, and make the verbatim branch the DEFAULT. That
 * default is the designed common case, not an error state — most shapes will
 * never earn a bespoke renderer and do not need one. A surface that renders
 * blank for the shapes nobody anticipated has failed at exactly the moment it
 * mattered, and one that pretty-prints something it misidentified has failed
 * worse.
 */

import type { ContentForm } from "@avigopal/design-tokens";
import type { ReactNode } from "react";
import { parseDiff, parseRows } from "../lib/ledger";
import { Prose } from "./Prose";

function Verbatim({ text }: { text: string }): ReactNode {
  return <pre className="sf-verbatim">{text}</pre>;
}

function Rows({ text }: { text: string }): ReactNode {
  const parsed = parseRows(text);
  // Parsing can fail on a truncated preview of a JSON array. Falling through to
  // verbatim is the honest rendering of a fragment — better a readable
  // fragment than an empty table that claims there were no rows.
  if (!parsed || parsed.columns.length === 0) return <Verbatim text={text} />;
  return (
    <table className="sf-table">
      <thead>
        <tr>
          {parsed.columns.map((column) => (
            <th key={column} scope="col">
              {column}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {parsed.rows.map((row, i) => (
          // Rows parsed out of a blob carry no domain id of their own; their
          // position in the parsed table is their identity, and the table is
          // re-parsed wholesale rather than reconciled.
          // @interaction:exempt P4 — parsed table rows carry no domain id; position IS identity and the blob is re-parsed wholesale, never reconciled
          <tr key={`r${i}`}>
            {parsed.columns.map((column, j) => (
              <td key={column}>{row[j] ?? ""}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Diff({ text }: { text: string }): ReactNode {
  const lines = parseDiff(text);
  return (
    <pre className="sf-diff">
      {lines.map((line, i) => (
        // @interaction:exempt P4 — diff lines have no id; the hunk is re-rendered whole on every content change
        <div key={`d${i}`} className="sf-diff-line" data-kind={line.kind}>
          {line.text === "" ? " " : line.text}
        </div>
      ))}
    </pre>
  );
}

export function ContentRender({ form, text }: { form: ContentForm; text: string }): ReactNode {
  switch (form) {
    case "prose":
      return <Prose source={text} />;
    case "rows":
      return <Rows text={text} />;
    case "diff":
      return <Diff text={text} />;
    case "empty":
      // The caller normally handles the empty case with its own copy, because
      // emptiness needs NAMING rather than rendering. This branch exists so a
      // form of "empty" arriving here cannot fall through to a blank <pre>.
      return (
        <p className="sf-ledger-empty">
          No content. This impulse carries a shape and nothing else.
        </p>
      );
    case "text":
    default:
      // THE DEFAULT BRANCH. Every unrecognised form lands here and renders
      // exactly what arrived, unmodified.
      return <Verbatim text={text} />;
  }
}
