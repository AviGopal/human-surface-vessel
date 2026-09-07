import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
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
import { Fragment } from "react";
const INLINE = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g;
function renderInline(text, keyPrefix) {
    const parts = text.split(INLINE).filter((p) => p !== undefined && p !== "");
    return parts.map((part, i) => {
        const key = `${keyPrefix}:${i}:${part.slice(0, 12)}`;
        if (part.startsWith("`") && part.endsWith("`") && part.length > 1) {
            return _jsx("code", { children: part.slice(1, -1) }, key);
        }
        if (part.startsWith("**") && part.endsWith("**") && part.length > 3) {
            return _jsx("strong", { children: part.slice(2, -2) }, key);
        }
        if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
            return _jsx("em", { children: part.slice(1, -1) }, key);
        }
        const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
        if (link) {
            // The label, then the target as plain text. Nothing is clickable.
            return (_jsxs(Fragment, { children: [link[1], " ", _jsxs("span", { className: "sf-muted sf-mono", children: ["(", link[2], ")"] })] }, key));
        }
        return _jsx(Fragment, { children: part }, key);
    });
}
function parseBlocks(source) {
    const lines = source.replace(/\r\n/g, "\n").split("\n");
    const blocks = [];
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
            const body = [];
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
            const items = [];
            while (i < lines.length && /^[-*+]\s+/.test((lines[i] ?? "").trimEnd())) {
                items.push((lines[i] ?? "").trimEnd().replace(/^[-*+]\s+/, ""));
                i += 1;
            }
            blocks.push({ kind: "ul", items });
            continue;
        }
        if (/^\d+\.\s+/.test(line)) {
            const items = [];
            while (i < lines.length && /^\d+\.\s+/.test((lines[i] ?? "").trimEnd())) {
                items.push((lines[i] ?? "").trimEnd().replace(/^\d+\.\s+/, ""));
                i += 1;
            }
            blocks.push({ kind: "ol", items });
            continue;
        }
        if (/^>\s?/.test(line)) {
            const quote = [];
            while (i < lines.length && /^>\s?/.test((lines[i] ?? "").trimEnd())) {
                quote.push((lines[i] ?? "").trimEnd().replace(/^>\s?/, ""));
                i += 1;
            }
            blocks.push({ kind: "quote", lines: quote });
            continue;
        }
        const para = [];
        while (i < lines.length) {
            const next = (lines[i] ?? "").trimEnd();
            if (next.trim() === "")
                break;
            if (/^(#{1,6}\s|[-*+]\s|\d+\.\s|>\s?|```)/.test(next))
                break;
            para.push(next);
            i += 1;
        }
        blocks.push({ kind: "p", lines: para });
    }
    return blocks;
}
/**
 * Whether a paragraph is really a machine record that arrived unfenced.
 *
 * The failure this closes: an answer body containing a bare
 * `{"shape":"shellResult","stdout":"76325\n"}` line rendered in the READING
 * SERIF, while the identical bytes rendered in mono 700px lower inside the
 * same run's impulse card — two type roles for one artefact on one screen.
 * A CSS rule cannot reach it, because unfenced JSON carries no backticks and
 * so never becomes a `<code>` element in the first place.
 *
 * The test is `JSON.parse` succeeding on an object or array, not a regex: a
 * sentence that merely contains a brace is prose and must stay prose.
 */
function isMachineRecordLine(lines) {
    if (lines.length !== 1)
        return false;
    const text = (lines[0] ?? "").trim();
    if (text.length < 2)
        return false;
    const opens = text.startsWith("{") || text.startsWith("[");
    const closes = text.endsWith("}") || text.endsWith("]");
    if (!opens || !closes)
        return false;
    try {
        const parsed = JSON.parse(text);
        return typeof parsed === "object" && parsed !== null;
    }
    catch {
        return false;
    }
}
export function Prose({ source }) {
    const blocks = parseBlocks(source);
    return (_jsx("div", { className: "sf-prose", children: blocks.map((block, index) => {
            // Blocks have no domain id — they are derived from a position in a
            // document, so position IS their identity here. This is not the P4 case,
            // which is about rows that carry a stable id and must keep it.
            const key = `${block.kind}-${index}`;
            switch (block.kind) {
                case "h": {
                    const Tag = (block.level <= 2 ? "h2" : "h3");
                    return _jsx(Tag, { children: renderInline(block.text, key) }, key);
                }
                case "ul":
                    return (_jsx("ul", { children: block.items.map((item, j) => (_jsx("li", { children: renderInline(item, `${key}-${j}`) }, `${key}-${j}`))) }, key));
                case "ol":
                    return (_jsx("ol", { children: block.items.map((item, j) => (_jsx("li", { children: renderInline(item, `${key}-${j}`) }, `${key}-${j}`))) }, key));
                case "quote":
                    return _jsx("blockquote", { children: renderInline(block.lines.join(" "), key) }, key);
                case "code":
                    return (_jsx("pre", { className: "sf-verbatim", "data-lang": block.lang, children: block.lines.join("\n") }, key));
                case "hr":
                    return _jsx("hr", {}, key);
                case "p":
                default:
                    // Machine record reads as machine record, in the same mono role it
                    // gets everywhere else in this surface. Content is unchanged and
                    // nothing is hidden — only the type role is corrected.
                    return isMachineRecordLine(block.lines) ? (_jsx("pre", { className: "sf-verbatim", "data-lang": "json", children: block.lines.join("\n") }, key)) : (_jsx("p", { children: renderInline(block.lines.join(" "), key) }, key));
            }
        }) }));
}
//# sourceMappingURL=Prose.js.map