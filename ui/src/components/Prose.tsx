/**
 * A markdown-lite renderer that builds React elements directly.
 *
 * No markdown library, for two reasons. One is rule P12 — every dependency is
 * bundle surface, and a markdown renderer is a large one. The other is that
 * building elements rather than HTML strings means there is no
 * `dangerouslySetInnerHTML` anywhere in this surface, so untrusted impulse
 * content cannot inject markup no matter what a walk put in the pool.
 *
 * Link targets are rendered as visible text rather than as anchors. Impulse
 * content is not trusted input, and a clickable link to a host a walk invented
 * is exactly the "never invent a vessel address" failure wearing a different
 * hat.
 */

import { Fragment, type ReactNode } from "react";

const INLINE = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g;

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const parts = text.split(INLINE).filter((p) => p !== undefined && p !== "");
  return parts.map((part, i) => {
    const key = `${keyPrefix}:${i}:${part.slice(0, 12)}`;
    if (part.startsWith("`") && part.endsWith("`") && part.length > 1) {
      return <code key={key}>{part.slice(1, -1)}</code>;
    }
    if (part.startsWith("**") && part.endsWith("**") && part.length > 3) {
      return <strong key={key}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
      return <em key={key}>{part.slice(1, -1)}</em>;
    }
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
    if (link) {
      // The label, then the target as plain text. Nothing is clickable.
      return (
        <Fragment key={key}>
          {link[1]} <span className="sf-muted sf-mono">({link[2]})</span>
        </Fragment>
      );
    }
    return <Fragment key={key}>{part}</Fragment>;
  });
}

type Block =
  | { kind: "p"; lines: string[] }
  | { kind: "h"; level: number; text: string }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] }
  | { kind: "quote"; lines: string[] }
  | { kind: "code"; lines: string[]; lang: string }
  | { kind: "hr" };

function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const raw = lines[i] ?? "";
    const line = raw.trimEnd();

    if (line.trim() === "") {
      i += 1;
      continue;
    }

    const fence = /^```(\w*)\s*$/.exec(line.trim());
    if (fence) {
      const lang = fence[1] ?? "";
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !/^```/.test((lines[i] ?? "").trim())) {
        body.push(lines[i] ?? "");
        i += 1;
      }
      i += 1; // closing fence, or end of a truncated preview
      blocks.push({ kind: "code", lines: body, lang });
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      blocks.push({ kind: "hr" });
      i += 1;
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({ kind: "h", level: heading[1]?.length ?? 1, text: heading[2] ?? "" });
      i += 1;
      continue;
    }

    if (/^[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*+]\s+/.test((lines[i] ?? "").trimEnd())) {
        items.push((lines[i] ?? "").trimEnd().replace(/^[-*+]\s+/, ""));
        i += 1;
      }
      blocks.push({ kind: "ul", items });
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test((lines[i] ?? "").trimEnd())) {
        items.push((lines[i] ?? "").trimEnd().replace(/^\d+\.\s+/, ""));
        i += 1;
      }
      blocks.push({ kind: "ol", items });
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^>\s?/.test((lines[i] ?? "").trimEnd())) {
        quote.push((lines[i] ?? "").trimEnd().replace(/^>\s?/, ""));
        i += 1;
      }
      blocks.push({ kind: "quote", lines: quote });
      continue;
    }

    const para: string[] = [];
    while (i < lines.length) {
      const next = (lines[i] ?? "").trimEnd();
      if (next.trim() === "") break;
      if (/^(#{1,6}\s|[-*+]\s|\d+\.\s|>\s?|```)/.test(next)) break;
      para.push(next);
      i += 1;
    }
    blocks.push({ kind: "p", lines: para });
  }

  return blocks;
}

export function Prose({ source }: { source: string }): ReactNode {
  const blocks = parseBlocks(source);
  return (
    <div className="sf-prose">
      {blocks.map((block, index) => {
        // Blocks have no domain id — they are derived from a position in a
        // document, so position IS their identity here. This is not the P4 case,
        // which is about rows that carry a stable id and must keep it.
        const key = `${block.kind}-${index}`;
        switch (block.kind) {
          case "h": {
            const Tag = (block.level <= 2 ? "h2" : "h3") as "h2" | "h3";
            return <Tag key={key}>{renderInline(block.text, key)}</Tag>;
          }
          case "ul":
            return (
              <ul key={key}>
                {block.items.map((item, j) => (
                  <li key={`${key}-${j}`}>{renderInline(item, `${key}-${j}`)}</li>
                ))}
              </ul>
            );
          case "ol":
            return (
              <ol key={key}>
                {block.items.map((item, j) => (
                  <li key={`${key}-${j}`}>{renderInline(item, `${key}-${j}`)}</li>
                ))}
              </ol>
            );
          case "quote":
            return <blockquote key={key}>{renderInline(block.lines.join(" "), key)}</blockquote>;
          case "code":
            return (
              <pre key={key} className="sf-verbatim" data-lang={block.lang}>
                {block.lines.join("\n")}
              </pre>
            );
          case "hr":
            return <hr key={key} />;
          case "p":
          default:
            return <p key={key}>{renderInline(block.lines.join(" "), key)}</p>;
        }
      })}
    </div>
  );
}
