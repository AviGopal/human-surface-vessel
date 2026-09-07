import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * ASK — one box, and what happens the moment you use it.
 *
 * A human sends goals in natural language. This surface does not ask anyone to
 * pre-decompose a request, name a target shape, or speak the system's internal
 * vocabulary: if a goal only works after somebody rewrites it with file paths
 * and expected shapes, that rewriting is a gap in the system, not a workflow to
 * institutionalise here.
 *
 * The run contract appears ON SUBMIT, not before — it describes the walk that
 * was just accepted, and it carries a duration BAND rather than an estimate and
 * no confidence number at all.
 */
import { useRef, useState } from "react";
import { useDispatchGoal, useFleetShapes } from "../api/queries";
import { buildContract } from "../lib/contract";
import { inferTargetShapes } from "../lib/starters";
import { formatDurationBand } from "../lib/time";
import { StarterChips } from "./StarterChips";
function ContractPanel({ contract, goal }) {
    return (_jsx("div", { className: "sf-contract", children: _jsxs("dl", { children: [_jsx("dt", { children: "What this is" }), _jsx("dd", { children: contract.klass }), _jsx("dt", { children: "Aiming at" }), _jsx("dd", { children: contract.targetShapes.length > 0 ? (_jsxs(_Fragment, { children: [contract.targetShapes.map((shape, i) => (_jsxs("span", { children: [i > 0 ? ", " : "", _jsx("span", { className: "sf-mono", children: shape })] }, shape))), " ", _jsx("span", { className: "sf-muted", children: "\u2014 inferred from your wording against the live vocabulary. The walk decides for itself; this is what it looks like it is heading for." })] })) : (_jsx("span", { className: "sf-muted", children: "Nothing in your wording matched a known shape name. The walk will infer its own targets \u2014 this is not a problem, only something this surface cannot preview." })) }), _jsx("dt", { children: "How long" }), _jsxs("dd", { children: [formatDurationBand(contract.lowSec, contract.highSec), _jsx("br", {}), _jsxs("span", { className: "sf-muted", children: [contract.bandBasis, "."] })] }), _jsx("dt", { children: "It will ask you about" }), _jsx("dd", { children: _jsx("ul", { style: { margin: 0, paddingLeft: "var(--sf-space-5)" }, children: contract.willAskAbout.map((item) => (_jsx("li", { children: item }, item))) }) }), _jsx("dt", { children: "What was sent" }), _jsx("dd", { className: "sf-mono sf-muted", children: goal })] }) }));
}
function OutcomeNote({ outcome, onSuggest, }) {
    switch (outcome.kind) {
        case "reshaped":
            // Say plainly that NOTHING was dispatched. The reader is watching a runs
            // board; if this read like an acceptance they would wait for a row that
            // is never coming.
            return (_jsxs("div", { className: "sf-outcome", role: "status", children: ["This changed the interface itself \u2014 nothing was dispatched and no run will appear below.", outcome.revision >= 0 ? ` Render policy is now revision ${outcome.revision}.` : "", _jsx("ul", { className: "sf-outcome-changes", children: outcome.changes.map((c) => (_jsxs("li", { children: [_jsx("b", { children: c.field }), ": ", c.from, " \u2192 ", c.to, c.because ? _jsxs("span", { className: "sf-outcome-because", children: [" \u00B7 from \u201C", c.because, "\u201D"] }) : null] }, `${c.field}-${c.to}`))) }), outcome.unparsed.length > 0 ? (_jsxs("span", { className: "sf-outcome-unparsed", children: ["Not understood, and therefore not applied. The rest was applied.", _jsx("ul", { className: "sf-outcome-unparsed-list", children: outcome.unparsed.map((u) => (_jsxs("li", { children: ["\u201C", u.text, "\u201D", u.reason ? _jsxs("span", { className: "sf-outcome-because", children: [" \u2014 ", u.reason] }) : null, u.suggestedGoal ? (_jsxs("button", { type: "button", className: "sf-button sf-button-quiet sf-outcome-suggest", onClick: () => onSuggest(u.suggestedGoal), children: ["put \u201C", u.suggestedGoal, "\u201D in the box"] })) : null] }, u.text))) })] })) : null] }));
        case "accepted":
            return outcome.coalesced ? (_jsxs("p", { className: "sf-warn", children: ["Coalesced onto an existing run (", outcome.dispatchId, "). This is an OLDER dispatch that was already in flight for the same goal \u2014 you did not create it, and it may already be part way through. What it produces will answer someone else's ask as much as yours."] })) : (_jsxs("p", { className: "sf-ok", children: ["Accepted as ", outcome.dispatchId, ". Accepted means the walk was received \u2014 not that anything has happened yet. The board says what it actually does."] }));
        case "refused":
            return (_jsxs("p", { className: "sf-error", children: ["Refused before anything ran", outcome.dispatchId ? ` (${outcome.dispatchId})` : "", ".", " ", outcome.reason ?? "No reason was given.", " Nothing was dispatched and nothing will appear on the board."] }));
        case "draining":
            return (_jsxs("p", { className: "sf-warn", children: ["The dispatcher is draining and did not take this: ", outcome.message, ". It is shutting down or restarting \u2014 retry shortly. Your goal was not queued."] }));
        case "rejected":
        default:
            return (_jsxs("p", { className: "sf-error", children: ["Not dispatched: ", outcome.message, ". Nothing ran."] }));
    }
}
export function AskRegion({ onDispatched }) {
    const [goal, setGoal] = useState("");
    const [contract, setContract] = useState(null);
    const textareaRef = useRef(null);
    const shapes = useFleetShapes();
    const dispatch = useDispatchGoal();
    /** P2: insert and focus. This function cannot dispatch — nothing here can. */
    const insert = (text) => {
        setGoal((current) => (current.trim().length === 0 ? text : `${current.trimEnd()} ${text}`));
        const el = textareaRef.current;
        if (el) {
            el.focus();
            // Cursor at the end, so finishing the sentence is the obvious next act.
            window.requestAnimationFrame(() => {
                el.selectionStart = el.value.length;
                el.selectionEnd = el.value.length;
            });
        }
    };
    /**
     * P2 again, but REPLACING rather than appending.
     *
     * `insert` appends, which is right for a starter chip building up a sentence.
     * It is wrong here: the box still holds the instruction whose clause was just
     * refused (submit does not clear it), so appending would produce the refused
     * words followed by the goal that replaces them. Taking the suggestion means
     * switching from steering the surface to asking for work, so the old text goes.
     * This still cannot dispatch — nothing in this component can.
     */
    const replaceWith = (text) => {
        setGoal(text);
        const el = textareaRef.current;
        if (el) {
            el.focus();
            window.requestAnimationFrame(() => {
                el.selectionStart = el.value.length;
                el.selectionEnd = el.value.length;
            });
        }
    };
    const submit = () => {
        const text = goal.trim();
        if (text.length === 0)
            return;
        const inferred = inferTargetShapes(text, shapes.data ?? []);
        setContract({ contract: buildContract(text, inferred), goal: text });
        dispatch.mutate({ goal: text, operator: "human-surface", tags: ["surface:do-anything"] }, {
            onSuccess: (outcome) => {
                // The contract describes A WALK THAT WILL RUN. It is built optimistically
                // on submit, because the reader deserves to see it before the wait — but
                // only ACCEPTED means a walk actually runs. On every other outcome it is
                // withdrawn, or the surface would show "what will happen" beside "nothing
                // was dispatched" and contradict itself in one frame. That is the exact
                // failure this surface exists to prevent, so it must not commit it.
                if (outcome.kind !== "accepted")
                    setContract(null);
                if (outcome.kind === "accepted" && outcome.dispatchId)
                    onDispatched(outcome.dispatchId);
                // "reshaped" deliberately falls through: there is no run to select.
                if (outcome.kind === "refused" && outcome.dispatchId)
                    onDispatched(outcome.dispatchId);
            },
        });
    };
    return (_jsxs("section", { className: "sf-region", "aria-labelledby": "sf-ask-title", children: [_jsx("div", { className: "sf-region-head", children: _jsx("h2", { className: "sf-region-title", id: "sf-ask-title", children: "Ask" }) }), _jsxs("div", { className: "sf-region-body", children: [_jsxs("form", { onSubmit: (e) => {
                            e.preventDefault();
                            submit();
                        }, children: [_jsx("label", { htmlFor: "sf-goal", className: "sf-visually-hidden", children: "What do you want done?" }), _jsx("textarea", { id: "sf-goal", ref: textareaRef, className: "sf-textarea", placeholder: "What do you want done?", value: goal, onChange: (e) => setGoal(e.target.value), onKeyDown: (e) => {
                                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                                        e.preventDefault();
                                        submit();
                                    }
                                } }), _jsxs("div", { style: {
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "var(--sf-space-3)",
                                    marginTop: "var(--sf-space-3)",
                                }, children: [_jsx("button", { type: "submit", className: "sf-button sf-button-primary", disabled: goal.trim().length === 0 || dispatch.isPending, children: dispatch.isPending ? "Sending…" : "Send" }), _jsx("span", { className: "sf-note sf-muted", children: "\u2318/Ctrl + Enter" }), contract ? (_jsx("button", { type: "button", className: "sf-button sf-button-quiet", onClick: () => {
                                            setContract(null);
                                            dispatch.reset();
                                        }, children: "dismiss the contract" })) : null] })] }), _jsx(StarterChips, { onInsert: insert }), dispatch.isError ? (_jsxs("p", { className: "sf-error", children: ["The dispatch never left this surface: ", dispatch.error.message, ". Nothing ran."] })) : null, dispatch.data ? _jsx(OutcomeNote, { outcome: dispatch.data, onSuggest: replaceWith }) : null, contract ? _jsx(ContractPanel, { contract: contract.contract, goal: contract.goal }) : null] })] }));
}
//# sourceMappingURL=AskRegion.js.map