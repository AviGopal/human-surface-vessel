/**
 * The run's answer: markdown prose, with the machine blobs the answer builder
 * pastes into it routed through the same shape-form pipeline as every impulse.
 */

import type { ReactNode } from "react";
import { fromResponse } from "../lib/content";
import { truncatedEnvelopePayload } from "../lib/ledger";
import { Rendered } from "./Rendered";
import { Prose } from "./Prose";

/**
 * Split an authored answer into prose and the machine blobs embedded in it.
 *
 * The answer builder writes markdown and then pastes the impulse it reasoned
 * from underneath a "## Basis" heading. Rendering the whole thing as markdown
 * therefore ran the blob through a paragraph renderer, and HTML whitespace
 * collapsing turned every escaped newline in it into a space — so the most
 * prominent card on the page destroyed the column alignment of the very output
 * it was citing, while the identical bytes rendered correctly as a terminal
 * listing in the ledger entry directly below it.
 *
 * Segments split on blank lines, which is where the builder joins them. A
 * segment that parses whole as JSON is content and goes to the form pipeline;
 * everything else is prose and stays markdown. Order is preserved, because the
 * blob's position under its heading is part of what the answer says.
 */
interface AnswerSegment {
  readonly kind: "prose" | "machine";
  readonly text: string;
  /**
   * The shape the blob declares for itself, used for the render-policy pin
   * lookup. Keying the pin on `goal_answer` instead would mean "show shellResult
   * as terminal" changed the ledger entry but not the copy of the same bytes in
   * the answer card above it — the two would disagree on screen about one
   * instruction.
   */
  readonly declaredShape?: string;
  /** The blob was cut off by the preview cap; planContent must be told so. */
  readonly truncated: boolean;
}

/**
 * A line that is a COMPLETE envelope on its own.
 *
 * A MATCH, not a guess, on the same terms as `truncatedEnvelopePayload`: the
 * line must parse as JSON, be a plain object, and DECLARE a shape. Anything
 * looser (any line that starts with `{`, any line that parses) would start
 * pulling ordinary prose that happens to contain braces out of the paragraph
 * it belongs to.
 *
 * WHY THIS EXISTS. `segmentAnswer` splits on BLANK lines and asks whether the
 * whole chunk starts with `{`. The answer builder does not always leave a blank
 * line: it writes a heading, a sentence, then the envelope the walk produced,
 * each separated by a single newline. That whole thing is one chunk beginning
 * with `#`, so it went to markdown — and markdown draws `{"stdout":"27\n"}`
 * with the escape visible. Measured on the deployed surface: this single case
 * was 4 of 5 unreadable results, across three different goal kinds.
 *
 * The fix is a PRE-SPLIT rather than a new branch: isolate such a line with
 * blank lines and let the existing, already-tested machine path claim it.
 */
const SHAPED_ENVELOPE_LINE = /^\s*\{.*\}\s*$/;

function isolateEnvelopeLines(body: string): string {
  if (!body.includes("{")) return body;
  return body
    .split("\n")
    .map((line) => {
      if (!SHAPED_ENVELOPE_LINE.test(line)) return line;
      try {
        const parsed: unknown = JSON.parse(line.trim());
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return line;
        const shape = (parsed as Record<string, unknown>)["shape"];
        if (typeof shape !== "string" || shape.length === 0) return line;
        // Blank lines around it make this line its own chunk below.
        return `\n${line.trim()}\n`;
      } catch {
        return line;
      }
    })
    .join("\n");
}

function segmentAnswer(body: string): readonly AnswerSegment[] {
  const out: AnswerSegment[] = [];
  for (const chunk of isolateEnvelopeLines(body).split(/\n\s*\n/)) {
    const text = chunk.trim();
    if (text.length === 0) continue;
    let machine = false;
    let truncatedBlob = false;
    let declaredShape: string | undefined;
    if (text.startsWith("{") || text.startsWith("[")) {
      try {
        const parsed: unknown = JSON.parse(text);
        machine = true;
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
          const s = (parsed as Record<string, unknown>)["shape"];
          if (typeof s === "string" && s.length > 0) declaredShape = s;
        }
      } catch {
        // It did not parse — but the answer builder pastes whatever the walk
        // produced, INCLUDING a preview the store already cut off. The ledger
        // entry for those same bytes renders as a terminal block; this card was
        // still handing them to markdown, so the identical output read cleanly
        // in one place and as escaped JSON in the other, on the same page.
        // The same conservative matcher decides: it recognises the envelope
        // opening whole or it declines.
        const cut = truncatedEnvelopePayload(text);
        if (cut) {
          machine = true;
          truncatedBlob = true;
          if (cut.envelopeShape) declaredShape = cut.envelopeShape;
        }
      }
    }
    // Merge consecutive prose so a paragraph break inside markdown does not
    // become a rendering boundary that loses list or heading continuity.
    const last = out[out.length - 1];
    if (!machine && last && last.kind === "prose") {
      out[out.length - 1] = { kind: "prose", text: `${last.text}\n\n${text}`, truncated: false };
      continue;
    }
    out.push({
      kind: machine ? "machine" : "prose",
      text,
      truncated: truncatedBlob,
      ...(declaredShape ? { declaredShape } : {}),
    });
  }
  return out;
}

/**
 * One non-prose segment of the answer card, with its form decision recorded.
 *
 * Extracted into its own component purely so the recorder's effect has a
 * component to live in — a `.map` callback is not one, and inlining a hook
 * there is the conditional-hook bug. The answer card is recorded because it IS
 * a form decision a person reads; leaving it out would make the corpus quietly
 * ledger-only while the answer is the part they came for.
 */
function AnswerSegmentView({ shape, text, truncated }: { shape: string; text: string; truncated: boolean }): ReactNode {
  return (
    <Rendered
      content={{ ...fromResponse(shape, text), state: truncated ? "truncated" : "full" }}
      density="full"
      header={false}
      region="answer_card"
    />
  );
}

/**
 * The answer builder opens with the goal as a heading and closes with a
 * "## Basis" section pasting the impulses it reasoned from. The run view
 * already shows the goal as its title and those impulses in the trace, so the
 * heading is dropped when it repeats the goal and the basis is folded.
 */
function splitAnswer(body: string, goal: string | undefined): { main: string; basis: string | null } {
  let text = body.trim();
  const firstLine = text.split("\n", 1)[0] ?? "";
  const heading = /^#\s+(.*)$/.exec(firstLine);
  if (heading && goal && heading[1]?.trim() === goal.trim()) text = text.slice(firstLine.length).trim();
  const at = text.search(/^##\s+Basis\s*$/m);
  if (at < 0) return { main: text, basis: null };
  const basis = text.slice(at).replace(/^##\s+Basis\s*\n?/, "").trim();
  return { main: text.slice(0, at).trim(), basis: basis.length > 0 ? basis : null };
}

function Segments({
  text,
}: {
  text: string;
}): ReactNode {
  return (
    <>
      {segmentAnswer(text).map((segment, i) =>
        segment.kind === "prose" ? (
          <Prose key={`s${i}`} source={segment.text} />
        ) : (
          <AnswerSegmentView
            key={`s${i}`}
            shape={segment.declaredShape ?? "goal_answer"}
            text={segment.text}
            truncated={segment.truncated}
          />
        ),
      )}
    </>
  );
}

export function AnswerBody({
  answerBody,
  goal,
}: {
  answerBody: string;
  goal?: string;
}): ReactNode {
  const { main, basis } = splitAnswer(answerBody, goal);
  return (
    <div className="sf-answer">
      {main ? <Segments text={main} /> : null}
      {basis ? (
        <details className="sf-answer-basis">
          <summary>Basis</summary>
          <Segments text={basis} />
        </details>
      ) : null}
    </div>
  );
}
