import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { normalizeLedger, planContent, PREVIEW_CAP, truncatedEnvelopePayload, } from "../lib/ledger";
import { formatChars } from "../lib/time";
import { describesFilesystem, extractPaths } from "../lib/tree";
import { ContentRender } from "./ContentRender";
import { Prose } from "./Prose";
function EntryHead({ entry }) {
    return (_jsxs("div", { className: "sf-ledger-head", children: [_jsx("span", { className: "sf-shape-badge", children: entry.shape }), _jsx("span", { className: "sf-note", children: entry.producedBy ? (_jsxs(_Fragment, { children: ["produced by ", _jsx("span", { className: "sf-mono", children: entry.producedBy })] })) : (_jsx("span", { className: "sf-muted", children: "no producer recorded" })) }), entry.goalSignature ? (_jsx("span", { className: "sf-muted sf-mono", style: { fontSize: "var(--sf-text-xs)" }, children: entry.goalSignature })) : null] }));
}
function Entry({ entry, formByShape, }) {
    if (entry.kind === "empty") {
        // NAME the emptiness. An empty impulse proves a step RAN; it does not
        // prove the step produced anything, and silently rendering nothing here
        // lets a reader count it as output.
        return (_jsxs("article", { className: "sf-ledger-entry", children: [_jsx(EntryHead, { entry: entry }), _jsx("p", { className: "sf-ledger-empty", children: "Empty \u2014 carries the shape but no content. This proves a step ran, not that it produced anything." })] }));
    }
    const plan = planContent(entry.shape, entry.preview, entry.truncated, formByShape);
    return (_jsxs("article", { className: "sf-ledger-entry", children: [_jsx(EntryHead, { entry: entry }), _jsx("div", { className: "sf-ledger-body", children: _jsx(ContentRender, { plan: plan }) }), _jsx("div", { className: "sf-ledger-foot", children: entry.truncated ? (_jsxs(_Fragment, { children: ["Showing the first ", formatChars(Math.min(entry.preview.length, PREVIEW_CAP)), " of", " ", formatChars(entry.chars), " characters \u2014 this is a preview, not the output. The full content is in the trace."] })) : plan.form === "stub" ? (_jsx(_Fragment, { children: "provenance only \u2014 0 characters of content" })) : plan.text !== entry.preview ? (_jsxs(_Fragment, { children: [formatChars(plan.text.length), " characters of content, unwrapped from a", " ", formatChars(entry.chars), "-character ", plan.envelopeShape ?? entry.shape, " record \u00B7 read as", " ", _jsx("span", { className: "sf-mono", children: plan.form })] })) : (_jsxs(_Fragment, { children: [formatChars(entry.chars), " characters, rendered in full \u00B7 read as", " ", _jsx("span", { className: "sf-mono", children: plan.form })] })) })] }));
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
function isolateEnvelopeLines(body) {
    if (!body.includes("{"))
        return body;
    return body
        .split("\n")
        .map((line) => {
        if (!SHAPED_ENVELOPE_LINE.test(line))
            return line;
        try {
            const parsed = JSON.parse(line.trim());
            if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
                return line;
            const shape = parsed["shape"];
            if (typeof shape !== "string" || shape.length === 0)
                return line;
            // Blank lines around it make this line its own chunk below.
            return `\n${line.trim()}\n`;
        }
        catch {
            return line;
        }
    })
        .join("\n");
}
function segmentAnswer(body) {
    const out = [];
    for (const chunk of isolateEnvelopeLines(body).split(/\n\s*\n/)) {
        const text = chunk.trim();
        if (text.length === 0)
            continue;
        let machine = false;
        let truncatedBlob = false;
        let declaredShape;
        if (text.startsWith("{") || text.startsWith("[")) {
            try {
                const parsed = JSON.parse(text);
                machine = true;
                if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
                    const s = parsed["shape"];
                    if (typeof s === "string" && s.length > 0)
                        declaredShape = s;
                }
            }
            catch {
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
                    if (cut.envelopeShape)
                        declaredShape = cut.envelopeShape;
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
/** Tier 1 of the fallback: real content, without per-impulse provenance. */
function AnswerEntry({ answerBody, producedBy, provenanceRetained, formByShape, }) {
    return (_jsxs("article", { className: "sf-ledger-entry sf-ledger-entry--answer", children: [_jsxs("div", { className: "sf-ledger-head", children: [_jsx("span", { className: "sf-shape-badge", children: "goal_answer" }), _jsx("span", { className: "sf-note", children: producedBy ? (_jsxs(_Fragment, { children: ["produced by ", _jsx("span", { className: "sf-mono", children: producedBy })] })) : (_jsx("span", { className: "sf-muted", children: "no producing template recorded" })) }), _jsx("span", { className: "sf-note sf-muted", children: provenanceRetained
                            ? "the answer rendered for a human — one impulse among those below, not the output itself"
                            : "recovered from the run's answer, not from the pool" })] }), _jsx("div", { className: "sf-ledger-body", children: segmentAnswer(answerBody).map((segment, i) => segment.kind === "prose" ? (_jsx(Prose
                // Segments carry no id. Their ORDER is their identity: the answer
                // is re-segmented wholesale on every content change and never
                // reconciled row by row, so position is the only stable handle.
                // @interaction:exempt P4 — answer segments carry no domain id; position IS identity and the body is re-segmented wholesale, never reconciled
                , { source: segment.text }, `s${i}`)) : (_jsx(ContentRender
                // @interaction:exempt P4 — answer segments carry no domain id; position IS identity and the body is re-segmented wholesale, never reconciled
                , { plan: planContent(segment.declaredShape ?? "goal_answer", segment.text, segment.truncated, formByShape) }, `s${i}`))) }), _jsxs("div", { className: "sf-ledger-foot", children: [formatChars(answerBody.length), " characters, rendered in full"] })] }));
}
function TreeNote({ goal, answerBody, provenanceText, }) {
    if (!describesFilesystem(goal, answerBody))
        return null;
    const { paths } = extractPaths([answerBody, provenanceText, goal]);
    return (_jsxs("p", { className: "sf-note sf-muted", style: { marginTop: "var(--sf-space-2)" }, children: ["This answer describes a filesystem, and the substrate reads ITS OWN working tree \u2014 not the checkout on your machine.", paths.length > 0 ? (_jsxs(_Fragment, { children: [" ", "The run named", " ", paths.map((p, i) => (_jsxs("span", { children: [i > 0 ? ", " : "", _jsx("span", { className: "sf-mono", children: p })] }, p))), "."] })) : (" The run did not record which path it read, so none is shown here."), " ", "A number that disagrees with your local copy is not necessarily wrong \u2014 both can be correct about their own tree."] }));
}
export function EvidenceLedger({ formByShape, provenance, completionShapes, answerBody, goal, selectedTemplateId, executionPath, }) {
    const entries = normalizeLedger(provenance);
    const provenanceText = entries
        .map((e) => (e.kind === "content" ? e.preview : ""))
        .join("\n")
        .slice(0, 8000);
    /* ── the pool has content: the normal, fully-attributed case ───────────── */
    if (entries.length > 0) {
        const covering = new Set(completionShapes ?? []);
        const emptyCount = entries.filter((e) => e.kind === "empty").length;
        return (_jsxs("div", { children: [_jsxs("p", { className: "sf-note", children: [entries.length, " impulse", entries.length === 1 ? "" : "s", " in the pool", emptyCount > 0 ? `, of which ${emptyCount} carry no content` : "", covering.size > 0
                            ? ` · ${[...covering].join(", ")} covered the goal's target shapes`
                            : " · none of them was recorded as covering the goal's target shapes", "."] }), answerBody ? (_jsx(AnswerEntry, { answerBody: answerBody, producedBy: selectedTemplateId, provenanceRetained: true, formByShape: formByShape })) : null, entries.map((entry, i) => (_jsx(Entry, { entry: entry, formByShape: formByShape }, `${entry.shape}-${i}`))), _jsx(TreeNote, { goal: goal, answerBody: answerBody, provenanceText: provenanceText })] }));
    }
    const pathNote = executionPath === "universal_tool_fallback"
        ? "This run went down the general tool loop, which executes without accumulating impulses in the pool — so there is no per-impulse provenance to show. That is a property of the path taken, not a sign the run produced nothing."
        : "This execution path did not retain per-impulse provenance — the content below is real, but which step produced it was not recorded.";
    /* ── tier 1: the answer itself ─────────────────────────────────────────── */
    if (answerBody && answerBody.trim().length > 0) {
        return (_jsxs("div", { children: [_jsx("p", { className: "sf-warn", children: pathNote }), _jsx(AnswerEntry, { answerBody: answerBody, producedBy: selectedTemplateId, provenanceRetained: false, formByShape: formByShape }), _jsx(TreeNote, { goal: goal, answerBody: answerBody, provenanceText: "" })] }));
    }
    /* ── tier 2: the shapes are known, their content is not ────────────────── */
    if (completionShapes && completionShapes.length > 0) {
        return (_jsxs("div", { children: [_jsx("p", { className: "sf-warn", children: pathNote }), _jsx("p", { className: "sf-note", children: "The run recorded which shapes covered the goal, but this execution path did not retain their content. These are the shapes \u2014 and a shape name is NOT the output. Nothing here lets you check what was actually produced; the trace is the only place that can." }), _jsx("ul", { className: "sf-shape-list", children: completionShapes.map((shape, i) => (_jsx("li", { className: "sf-shape-badge", children: shape }, `${shape}-${i}`))) })] }));
    }
    /* ── tier 3: genuinely nothing ─────────────────────────────────────────── */
    return (_jsx("p", { className: "sf-warn", children: "Nothing at all: no impulses in the pool, no answer, and no covering shapes. There is nothing here to judge \u2014 a run that reaches on an empty ledger reached on something this surface cannot show you, and a verdict you cannot check is not evidence." }));
}
//# sourceMappingURL=EvidenceLedger.js.map