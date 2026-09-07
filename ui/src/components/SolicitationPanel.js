import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * A mid-walk question is answered WHERE THE RUN IS.
 *
 * The failure this prevents is two half-surfaces: a question on one screen, the
 * run it belongs to on another, and the correlation work falling to the human.
 *
 * HONEST LIMITATION, stated in the UI as well as here: `goalWalkState` does not
 * carry pending solicitations. `poolEvents` is `{shape, source, at}` and
 * nothing else, and the `human_input` impulse that holds the question text and
 * its `solicitation_id` is posted to a separate sink vessel rather than
 * mirrored onto the dispatch record. So the walk log is the only signal here,
 * and when it names a question without its id, this panel says so rather than
 * guessing an id and posting an answer into nowhere.
 */
import { useState } from "react";
import { useAnswerSolicitation } from "../api/queries";
const OUTCOMES = [
    { value: "answered", label: "Answer it" },
    { value: "insufficient_context", label: "I can't tell from what it gave me" },
    { value: "declined", label: "Decline — don't wait on me" },
];
export function SolicitationPanel({ solicitation, }) {
    const [answer, setAnswer] = useState("");
    const [outcome, setOutcome] = useState("answered");
    const mutation = useAnswerSolicitation();
    return (_jsxs("div", { className: "sf-waiting-panel", children: [_jsx("p", { className: "sf-label", style: { margin: 0 }, children: "This run is waiting on you" }), _jsx("p", { className: "sf-mono", style: { fontSize: "var(--sf-text-sm)" }, children: solicitation.evidenceLine }), solicitation.solicitationId === null ? (_jsx("p", { className: "sf-note", children: "The walk log says a question was asked but does not carry its id, and the question itself lives in a separate impulse this surface cannot read. There is no way to answer it from here \u2014 the run will time out on its own." })) : (_jsxs(_Fragment, { children: [_jsx("label", { className: "sf-label", htmlFor: "sf-solicit-answer", children: "Your answer" }), _jsx("textarea", { id: "sf-solicit-answer", className: "sf-textarea", style: { minHeight: "4.5rem", fontSize: "var(--sf-text-base)" }, value: answer, onChange: (e) => setAnswer(e.target.value) }), _jsxs("div", { style: {
                            display: "flex",
                            gap: "var(--sf-space-2)",
                            alignItems: "center",
                            marginTop: "var(--sf-space-2)",
                            flexWrap: "wrap",
                        }, children: [_jsx("label", { className: "sf-label", htmlFor: "sf-solicit-outcome", children: "As" }), _jsx("select", { id: "sf-solicit-outcome", className: "sf-select", value: outcome, onChange: (e) => setOutcome(e.target.value), children: OUTCOMES.map((o) => (_jsx("option", { value: o.value, children: o.label }, o.value))) }), _jsx("button", { type: "button", className: "sf-button sf-button-primary", disabled: mutation.isPending || (outcome === "answered" && answer.trim().length === 0), onClick: () => mutation.mutate({
                                    solicitationId: solicitation.solicitationId,
                                    outcome,
                                    answer: answer.trim(),
                                }), children: mutation.isPending ? "Sending…" : "Send to the walk" })] }), mutation.isError ? (_jsxs("p", { className: "sf-error", children: ["The answer was not delivered: ", mutation.error.message, ". The walk is still waiting."] })) : null, mutation.isSuccess ? _jsx("p", { className: "sf-ok", children: "Delivered. The walk resumes from where it stopped." }) : null] }))] }));
}
//# sourceMappingURL=SolicitationPanel.js.map