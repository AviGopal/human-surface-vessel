import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
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
 *
 * Which is the whole design of the three forms added below. `terminal`,
 * `record` and `scalar` fire only on POSITIVE evidence assembled in
 * `planContent` — a full successful `JSON.parse` of a NON-truncated preview —
 * and every one of them falls back to verbatim rather than draw a value it
 * could not confirm. A truncated fragment never reaches them at all.
 */
import { useEffect, useState } from "react";
import { heuristicForm, parseDiff, parseRows } from "../lib/ledger";
import { Prose } from "./Prose";
/** Above this a value is not a scalar, whatever the plan said. */
const SCALAR_MAX_CHARS = 300;
/** Beyond this depth a record summarises instead of recursing. */
const RECORD_MAX_DEPTH = 2;
function Verbatim({ text }) {
    return _jsx("pre", { className: "sf-verbatim", children: text });
}
function Rows({ text }) {
    const parsed = parseRows(text);
    // Parsing can fail on a truncated preview of a JSON array. Falling through to
    // verbatim is the honest rendering of a fragment — better a readable
    // fragment than an empty table that claims there were no rows.
    if (!parsed || parsed.columns.length === 0)
        return _jsx(Verbatim, { text: text });
    return (_jsx("div", { className: "sf-scroll-x", children: _jsxs("table", { className: "sf-table", children: [_jsx("thead", { children: _jsx("tr", { children: parsed.columns.map((column) => (_jsx("th", { scope: "col", children: column }, column))) }) }), _jsx("tbody", { children: parsed.rows.map((row, i) => (_jsx("tr", { children: parsed.columns.map((column, j) => {
                            const c = row[j];
                            return (_jsx("td", { title: c?.title, className: c?.summarised ? "sf-cell-summary" : undefined, children: c?.text ?? "" }, column));
                        }) }, `r${i}`))) })] }) }));
}
function Diff({ text }) {
    const lines = parseDiff(text);
    return (_jsx("pre", { className: "sf-diff", children: lines.map((line, i) => (_jsx("div", { className: "sf-diff-line", "data-kind": line.kind, children: line.text === "" ? " " : line.text }, `d${i}`))) }));
}
/**
 * Copy, feature-detected.
 *
 * When the clipboard API is absent the button is not rendered at all rather
 * than rendered dead: an affordance that does nothing when pressed teaches a
 * reader that this surface's controls are decorative.
 */
function CopyButton({ text, what }) {
    const [copied, setCopied] = useState(false);
    useEffect(() => {
        if (!copied)
            return;
        const timer = setTimeout(() => setCopied(false), 1500);
        return () => clearTimeout(timer);
    }, [copied]);
    if (typeof navigator === "undefined" || !navigator.clipboard)
        return null;
    return (_jsx("button", { type: "button", className: "sf-scalar-copy", "aria-label": `Copy ${what}`, onClick: () => {
            navigator.clipboard.writeText(text).then(() => setCopied(true), 
            // A refused clipboard is not a copy. Saying "copied" anyway is the
            // green-tick-over-nothing failure in miniature.
            () => setCopied(false));
        }, children: copied ? "copied" : "copy" }));
}
/** UUIDs and long opaque tokens read as machine identifiers; words do not. */
function isIdentifier(t) {
    return (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t) ||
        /^[A-Za-z0-9_:+/.-]{16,}$/.test(t));
}
/**
 * ONE short value, in reading type.
 *
 * Explicitly not a `<pre>` and explicitly not `.sf-verbatim`: `4`, or a goal
 * sentence, is not a code listing, and putting it in a monospace block was how
 * a one-word answer came to look like a fragment of machine output.
 */
function Scalar({ text, label }) {
    // Trimmed, because the commonest scalar in the pool is a command's `stdout`
    // and it arrives as `"1\n"` — the trailing newline is transport, not content,
    // and refusing the value over it would send the answer `1` back to a
    // monospace block.
    const value = text.trim();
    // Defensive re-check, because a PIN can reach this renderer without having
    // gone through the planner's own test. A 90KB blob must not be asked to sit
    // on one line. The ORIGINAL is what falls through — nothing is dropped.
    if (value.includes("\n") || value.length > SCALAR_MAX_CHARS) {
        return _jsx(Verbatim, { text: text });
    }
    return (_jsxs("div", { className: "sf-scalar", children: [label ? _jsx("span", { className: "sf-scalar-label", children: label }) : null, _jsx("span", { className: "sf-scalar-value", "data-mono": isIdentifier(value), children: value }), _jsx(CopyButton, { text: value, what: label ?? "value" })] }));
}
function MetaChipView({ chip }) {
    if (chip.kind === "exit") {
        // Foreground only, no fill, and its own class — `.sf-chip` carries a
        // clickable hover affordance this must not borrow, and an exit code is NOT
        // a reach verdict: a command that exits 0 has said nothing about whether
        // the goal was met, so it does not get the paint that verdict wears. The
        // word "exit N" is always present, so the state is never carried by colour.
        return (_jsxs("span", { className: "sf-exit-chip", "data-exit": chip.code === 0 ? "zero" : "nonzero", children: ["exit ", chip.code] }));
    }
    if (chip.kind === "stderr") {
        // Collapsed, because stderr that did not become the payload is context.
        // Dropping it would hide a warning; leading with it would bury the output.
        return (_jsxs("details", { className: "sf-envelope-stderr", children: [_jsxs("summary", { children: ["stderr (", plural(chip.text.length, "character", "characters"), ")"] }), _jsx("pre", { className: "sf-verbatim", children: chip.text })] }));
    }
    if (chip.kind === "envelopeShape") {
        return _jsx("span", { className: "sf-muted sf-mono", children: chip.shape });
    }
    return null;
}
/**
 * The envelope's non-payload fields, as chips.
 *
 * NEVER as JSON — re-printing the wrapper under the content it wrapped is the
 * defect this whole pre-pass exists to remove.
 */
function EnvelopeMeta({ meta }) {
    if (!meta || meta.length === 0)
        return null;
    return (_jsx("div", { className: "sf-envelope-meta", children: meta.map((chip) => (_jsx(MetaChipView, { chip: chip }, chip.kind))) }));
}
/**
 * Command output, with its columns intact.
 *
 * `white-space: pre`, not `pre-wrap`: soft-wrapping is precisely what destroyed
 * the systemd unit table's alignment, and a line that runs off the right edge
 * of the card is recoverable by scrolling while a reflowed table is not. The
 * horizontal scroll lives on the `<pre>`, never on the page.
 */
function Terminal({ text }) {
    return (_jsx("div", { className: "sf-terminal-wrap", children: _jsx("pre", { className: "sf-terminal", children: text }) }));
}
function plural(n, one, many) {
    return `${n} ${n === 1 ? one : many}`;
}
/**
 * One field of a record, drawn by its own kind.
 *
 * Exhaustive by construction: every JSON value type has a branch, so there is
 * no residue for a later reader to guess about. The depth cap is the load-
 * bearing part — a 93KB `substrateGap` body nests further than any screen can
 * hold, and unbounded recursion there produces a page that cannot be read and a
 * browser that stops responding. Past the cap it summarises and says so.
 */
function renderValue(key, v, depth) {
    if (v === null || v === undefined)
        return _jsx("span", { className: "sf-muted", children: "null" });
    if (typeof v === "boolean" || typeof v === "number") {
        return _jsx("span", { className: "sf-scalar-value sf-mono", children: String(v) });
    }
    if (typeof v === "string") {
        if (!v.includes("\n") && v.length <= SCALAR_MAX_CHARS) {
            return _jsx("span", { className: "sf-scalar-value", children: v });
        }
        // The long-string case, and the reason it matters: this is how a
        // `codeReadResult.content` or a `memoryNote` body becomes terminal or prose
        // instead of an escaped ribbon inside a table-shaped box.
        return _jsx(ContentRender, { plan: { form: heuristicForm(key, v, true), text: v } });
    }
    if (Array.isArray(v)) {
        if (v.length === 0)
            return _jsx("span", { className: "sf-muted", children: "empty list" });
        const objects = v.every((e) => typeof e === "object" && e !== null && !Array.isArray(e));
        // An array of objects IS a table — but ONLY when its rows are flat.
        //
        // A table cell holds one value. When a row's fields are themselves objects
        // or arrays, `cell()` cannot draw them and prints `{2 fields}` with the
        // real content in a title attribute, so a 918-character payload rendered as
        // the string `{2 fields}` under a footer reading "918 characters, rendered
        // in full". That is worse than the raw JSON it replaced: the JSON was ugly
        // and complete, and this was tidy and false.
        //
        // So: flat rows go to the table, nested rows go to the recursive record
        // renderer, which can actually draw them.
        const flat = objects && v.every((e) => Object.values(e).every((cellValue) => cellValue === null || typeof cellValue !== "object"));
        if (flat)
            return _jsx(Rows, { text: JSON.stringify(v) });
        if (objects && depth < RECORD_MAX_DEPTH) {
            return (_jsx("ul", { className: "sf-value-list", children: v.map((item, i) => (_jsx("li", { children: _jsx(RecordDl, { o: item, depth: depth + 1 }) }, `${i}:record`))) }));
        }
        const scalars = v.every((e) => e === null || typeof e !== "object");
        if (scalars || depth < RECORD_MAX_DEPTH) {
            return (_jsx("ul", { className: "sf-value-list", children: v.map((item, i) => (_jsx("li", { children: renderValue(key, item, depth + 1) }, `${i}:${typeof item}`))) }));
        }
        return _jsx(Summarised, { label: plural(v.length, "item", "items"), value: v });
    }
    if (depth < RECORD_MAX_DEPTH) {
        return _jsx(RecordDl, { o: v, depth: depth + 1 });
    }
    return _jsx(Summarised, { label: plural(Object.keys(v).length, "field", "fields"), value: v });
}
/**
 * Indent a folded value, and put its embedded newlines back.
 *
 * `JSON.stringify(v, null, 2)` indents the STRUCTURE but leaves every string
 * value as one escaped ribbon, so a folded command envelope still showed its
 * output as `"a.ts\nb.ts\n"` on a single line. Multi-line strings are hoisted
 * out onto their own lines so the thing a reader unfolded is the thing they
 * were looking for.
 */
function stringifyForReading(value) {
    const json = JSON.stringify(value, null, 2) ?? String(value);
    return json.replace(/"((?:[^"\\]|\\.)*)"/g, (whole, body) => {
        if (!body.includes("\\n"))
            return whole;
        const lines = body.replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
        return `\n${lines}`;
    });
}
/** Past the depth cap. The value is not dropped — it is folded, and named. */
function Summarised({ label, value }) {
    return (_jsxs("details", { className: "sf-record-more", children: [_jsx("summary", { children: label }), _jsx("pre", { className: "sf-verbatim sf-verbatim--fixed", children: stringifyForReading(value) })] }));
}
function RecordDl({ o, depth }) {
    return (_jsx("dl", { className: depth > 1 ? "sf-record sf-record--nested" : "sf-record", children: Object.keys(o).map((key) => (_jsxs("div", { className: "sf-record-row", children: [_jsx("dt", { className: "sf-record-key", children: key }), _jsx("dd", { className: "sf-record-value", children: renderValue(key, o[key], depth) })] }, key))) }));
}
function RecordFields({ text }) {
    let parsed;
    try {
        parsed = JSON.parse(text.trim());
    }
    catch {
        // `planContent` only emits `record` after a successful parse, so this is
        // unreachable from the planner — but a human PIN reaches this renderer
        // directly, and a renderer that trusts its caller is a renderer that
        // renders a guess.
        return _jsx(Verbatim, { text: text });
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        return _jsx(Verbatim, { text: text });
    }
    const o = parsed;
    if (Object.keys(o).length === 0)
        return _jsx(Verbatim, { text: text });
    return _jsx(RecordDl, { o: o, depth: 1 });
}
/** `activity:⟨compose⟩` reads as `compose`; the punctuation is transport. */
function activityLabel(producedBy) {
    return producedBy.replace(/^activity:/, "").replace(/^⟨(.*)⟩$/, "$1");
}
function Stub({ text }) {
    let parsed;
    try {
        parsed = JSON.parse(text.trim());
    }
    catch {
        return _jsx(Verbatim, { text: text });
    }
    const o = (typeof parsed === "object" && parsed !== null ? parsed : {});
    const producedBy = typeof o["producedBy"] === "string" ? o["producedBy"] : null;
    const executionId = typeof o["executionId"] === "string" ? o["executionId"] : null;
    if (producedBy === null || executionId === null)
        return _jsx(Verbatim, { text: text });
    return (_jsxs("p", { className: "sf-stub", children: ["No content carried \u2014 this impulse records only that a step ran. Produced by", " ", _jsx("span", { className: "sf-mono", children: activityLabel(producedBy) }), " in execution", " ", _jsx("span", { className: "sf-mono", children: executionId }), ". ", _jsx(CopyButton, { text: executionId, what: "the execution id" })] }));
}
function FormBody({ plan }) {
    switch (plan.form) {
        case "prose":
            return _jsx(Prose, { source: plan.text });
        case "rows":
            return _jsx(Rows, { text: plan.text });
        case "diff":
            return _jsx(Diff, { text: plan.text });
        case "terminal":
            return _jsx(Terminal, { text: plan.text });
        case "record":
            return _jsx(RecordFields, { text: plan.text });
        case "scalar":
            return _jsx(Scalar, { text: plan.text, label: plan.label });
        case "stub":
            return _jsx(Stub, { text: plan.text });
        case "empty":
            // The caller normally handles the empty case with its own copy, because
            // emptiness needs NAMING rather than rendering. This branch exists so a
            // form of "empty" arriving here cannot fall through to a blank <pre>.
            return (_jsx("p", { className: "sf-ledger-empty", children: "No content. This impulse carries a shape and nothing else." }));
        case "text":
        default:
            // THE DEFAULT BRANCH. Every unrecognised form lands here and renders
            // exactly what arrived, unmodified.
            return _jsx(Verbatim, { text: plan.text });
    }
}
export function ContentRender({ plan }) {
    // The envelope's context rides with EVERY form, not only with terminal.
    // Measured: a `{stdout:"", stderr:"boom\n", exit_code:2}` envelope unwraps to
    // the single line `boom`, and rendering that line alone shows the failure
    // TEXT while hiding that it WAS a failure — the exit code is the most
    // load-bearing fact on the card and it is not part of the payload. A command
    // that ran and printed nothing has nothing BUT its exit code.
    return (_jsxs(_Fragment, { children: [_jsx(FormBody, { plan: plan }), _jsx(EnvelopeMeta, { meta: plan.meta })] }));
}
//# sourceMappingURL=ContentRender.js.map