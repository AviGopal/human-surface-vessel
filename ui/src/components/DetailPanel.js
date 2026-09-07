import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { useInjectContext, useWalk, useRenderPolicy, } from "../api/queries";
import { deriveRunState, stateIsTerminal, verdictSentence, whatHappensNext } from "../lib/runState";
import { useNow } from "../lib/useNow";
import { useProgressWatch } from "../lib/useProgressWatch";
import { detectSolicitation, hasProgress, pathExplanation, progressFingerprint, walkLogText } from "../lib/walk";
import { EXECUTION_PATH_PROSE } from "../api/types";
import { useLiveControls, useRegionFreeze } from "../state/liveControls";
import { EvidenceLedger } from "./EvidenceLedger";
import { GradeGesture } from "./GradeGesture";
import { LiveControls } from "./LiveControls";
import { SolicitationPanel } from "./SolicitationPanel";
import { StateBadge } from "./StateBadge";
function InjectContext({ dispatchId }) {
    const [content, setContent] = useState("");
    const [shape, setShape] = useState("human_context");
    const mutation = useInjectContext();
    return (_jsxs("details", { children: [_jsx("summary", { children: "Push context into this run while it is still going" }), _jsxs("div", { style: { marginTop: "var(--sf-space-2)" }, children: [_jsx("p", { className: "sf-note sf-muted", children: "Confabulation is downstream of information starvation, not model weakness. If the walk is missing a fact, giving it the fact is cheaper and more likely to work than re-dispatching the same goal and hoping." }), _jsx("label", { className: "sf-label", htmlFor: "sf-inject-shape", children: "As shape" }), _jsx("input", { id: "sf-inject-shape", className: "sf-input", value: shape, onChange: (e) => setShape(e.target.value) }), _jsx("label", { className: "sf-label", htmlFor: "sf-inject-content", children: "Content" }), _jsx("textarea", { id: "sf-inject-content", className: "sf-textarea", style: { minHeight: "4.5rem", fontSize: "var(--sf-text-base)" }, value: content, onChange: (e) => setContent(e.target.value) }), _jsx("button", { type: "button", className: "sf-button", style: { marginTop: "var(--sf-space-2)" }, disabled: mutation.isPending || content.trim().length === 0 || shape.trim().length === 0, onClick: () => mutation.mutate({ dispatchId, shape: shape.trim(), content: content.trim() }), children: mutation.isPending ? "Pushing…" : "Push into the pool" }), mutation.isError ? (_jsxs("p", { className: "sf-error", children: ["Not accepted: ", mutation.error.message, ". A run that is no longer running will refuse this \u2014 that is a real answer, not a fault."] })) : null, mutation.isSuccess ? _jsx("p", { className: "sf-ok", children: "In the pool. The walk will drain it on its next iteration." }) : null] })] }));
}
function MachineRecord({ walk }) {
    // The one place `status` is rendered, and it is rendered BESIDE `reached`,
    // de-emphasised, below the verdict, and labelled as a machine record — never
    // in the position a reader scans for an outcome.
    return (_jsxs("p", { className: "sf-machine-record", children: ["machine record \u00B7 status=", walk.status, " \u00B7 reached=", String(walk.reached), walk.executionPath ? ` · path=${walk.executionPath}` : "", walk.executionId ? ` · execution=${walk.executionId}` : " · execution=<none recorded>", walk.selectedTemplateId ? ` · template=${walk.selectedTemplateId}` : "", typeof walk.attemptCount === "number" ? ` · attempts=${walk.attemptCount}` : "", walk.grounded !== null ? ` · grounded=${String(walk.grounded)}` : ""] }));
}
export function DetailPanel({ dispatchId }) {
    const { paused, intervalMs } = useLiveControls();
    const { frozen, handlers } = useRegionFreeze();
    const now = useNow(paused);
    const query = useWalk(dispatchId, { enabled: !paused && !frozen, intervalMs });
    // Rendering behaviour, re-read on the same cadence and frozen by the same
    // controls — a policy change must not move the surface under a reader who
    // has deliberately paused it.
    const renderPolicy = useRenderPolicy({ enabled: !paused && !frozen, intervalMs }).data;
    const walk = query.data;
    const fingerprint = walk ? progressFingerprint(walk) : "";
    const quietForMs = useProgressWatch(fingerprint, now);
    if (!dispatchId) {
        return (_jsxs("section", { className: "sf-region", "aria-labelledby": "sf-detail-title", ...handlers, children: [_jsx("div", { className: "sf-region-head", children: _jsx("h2", { className: "sf-region-title", id: "sf-detail-title", children: "Detail" }) }), _jsx("div", { className: "sf-region-body", children: _jsxs("p", { className: "sf-empty", children: [_jsx("strong", { children: "No run is open." }), "Pick a row on the board above and this shows four things, in this order: what was asked, what actually happened, every impulse the run produced, and what you can do next. A run's URL is shareable and survives a reload."] }) })] }));
    }
    const solicitation = walk ? detectSolicitation(walk) : null;
    const terminal = walk ? walk.status !== "running" : false;
    const state = walk
        ? deriveRunState({
            status: walk.status,
            reached: walk.reached,
            awaitingAnswer: solicitation !== null,
            hasProgress: hasProgress(walk),
            quietForMs: terminal ? null : quietForMs,
            // NULL here on purpose. `goalWalkState` does not carry `startedAt` —
            // only the board's `activeDispatches` record does — so the detail panel
            // cannot measure server-anchored silence and must not guess at it. The
            // board row, which is where a person scans for a stuck run anyway, has
            // the timestamp and makes the call there.
            acceptedForMs: null,
        })
        : "accepted";
    const sentence = walk
        ? verdictSentence({
            state,
            status: walk.status,
            reached: walk.reached,
            goalReachReason: walk.goalReachReason,
            ...(walk.error !== undefined ? { error: walk.error } : {}),
            humanGraded: walk.humanGraded,
        })
        : "";
    /**
     * Whether the answer card below already OPENS with this exact sentence.
     *
     * The panel was saying everything three times: the goal under "what was
     * asked", again as the answer card's heading, again inside the `goal`
     * impulse card; the verdict sentence twice within 400px. This removes one
     * of those repeats and only when it is a real repeat — a prefix comparison
     * on normalised whitespace, so a sentence that merely resembles the answer
     * still gets rendered.
     *
     * P1 is not at risk: the verdict itself is the StateBadge, which still
     * leads this part unconditionally. What is suppressed is a duplicated
     * REASON, never the verdict, and never on a run whose answer does not
     * already carry it.
     */
    const normalise = (s) => s.replace(/\s+/g, " ").trim().toLowerCase();
    const sentenceIsEchoedByAnswer = sentence.length > 24 &&
        typeof walk?.answerBody === "string" &&
        normalise(walk.answerBody).startsWith(normalise(sentence));
    const isTerminalState = stateIsTerminal(state);
    const explanation = walk && !isTerminalState ? null : walk ? pathExplanation(walk) : null;
    return (_jsxs("section", { className: "sf-region", "aria-labelledby": "sf-detail-title", ...handlers, children: [_jsxs("div", { className: "sf-region-head", children: [_jsx("h2", { className: "sf-region-title", id: "sf-detail-title", children: "Detail" }), _jsx(LiveControls, { frozen: frozen, regionName: "detail" })] }), _jsxs("div", { className: "sf-region-body", "aria-busy": query.isFetching, children: [query.isError ? (_jsxs("p", { className: "sf-error", children: ["This run could not be read: ", query.error.message, ". That is this surface failing, and it says nothing about whether the run itself is fine."] })) : null, !walk ? (_jsxs("p", { className: "sf-empty", children: ["Reading ", dispatchId, "\u2026"] })) : (_jsxs(_Fragment, { children: [_jsxs("div", { className: "sf-detail-part", children: [_jsx("p", { className: "sf-label", children: "What was asked" }), walk.goal ? (_jsx("p", { className: "sf-detail-goal", children: walk.goal })) : (_jsx("p", { className: "sf-detail-goal sf-muted", children: "The goal text was not recorded on this dispatch. The run happened; what was asked for is gone." })), _jsxs("p", { className: "sf-note sf-muted", style: { marginTop: "var(--sf-space-2)" }, children: [_jsx("span", { className: "sf-mono", children: walk.dispatchId }), walk.operator ? ` · asked by ${walk.operator}` : "", walk.trigger ? ` · triggered by ${walk.trigger}` : "", walk.requeueOf ? ` · a requeue of ${walk.requeueOf}` : ""] })] }), _jsxs("div", { className: "sf-detail-part", children: [_jsx("p", { className: "sf-label", children: "What happened" }), _jsx("div", { style: { marginTop: "var(--sf-space-2)" }, children: _jsx(StateBadge, { state: state }) }), sentenceIsEchoedByAnswer ? (_jsx("p", { className: "sf-note sf-muted", style: { marginTop: "var(--sf-space-2)" }, children: "The reason is the opening of the answer itself, below \u2014 it is not repeated here." })) : (_jsx("p", { className: "sf-verdict-sentence", children: sentence })), walk.humanGraded ? (_jsxs("p", { className: "sf-note", children: ["A human overrode the machine verdict on this run", walk.humanReachNotes ? `: “${walk.humanReachNotes}”` : "."] })) : null, walk.executionPath ? (_jsxs("p", { className: "sf-note", children: ["It ", EXECUTION_PATH_PROSE[walk.executionPath], explanation ? ` — ${explanation}` : "", "."] })) : null, _jsx(MachineRecord, { walk: walk }), solicitation ? _jsx(SolicitationPanel, { solicitation: solicitation }) : null] }), _jsxs("div", { className: "sf-detail-part", children: [_jsx("p", { className: "sf-label", children: "What it produced" }), _jsx("p", { className: "sf-note sf-muted", children: "Every impulse the walk put in the pool, mirrored regardless of outcome. This is the evidence \u2014 a shape name and a character count are not. When a path did not retain provenance, what it DID produce is still shown, labelled as such." }), _jsx(EvidenceLedger, { formByShape: renderPolicy?.formByShape, provenance: walk.poolProvenance, completionShapes: walk.completionShapes, answerBody: walk.answerBody, goal: walk.goal, selectedTemplateId: walk.selectedTemplateId, executionPath: walk.executionPath }), walk.poolShapes.length > 0 ? (_jsxs("details", { style: { marginTop: "var(--sf-space-2)" }, children: [_jsxs("summary", { children: [walk.poolShapes.length, " shapes in the pool"] }), _jsx("ul", { className: "sf-shape-list", children: walk.poolShapes.map((shape, i) => (_jsx("li", { className: "sf-shape-badge", children: shape }, `${shape}-${i}`))) })] })) : null, walk.walkLog.length > 0 ? (_jsxs("details", { style: { marginTop: "var(--sf-space-2)" }, children: [_jsxs("summary", { children: ["The walk log \u2014 the last ", walk.walkLog.length, " lines"] }), _jsx("div", { className: "sf-walklog", children: _jsx("ol", { children: walk.walkLog.map((entry, i) => (_jsx("li", { children: walkLogText(entry) }, `log-${i}`))) }) })] })) : (_jsx("p", { className: "sf-note sf-muted", style: { marginTop: "var(--sf-space-2)" }, children: "The walk recorded no log lines at all." }))] }), _jsxs("div", { className: "sf-detail-part", children: [_jsx("p", { className: "sf-label", children: "What happens next" }), _jsx("p", { className: "sf-note", children: whatHappensNext(state, walk.status === "running") }), walk.status === "running" ? _jsx(InjectContext, { dispatchId: walk.dispatchId }) : null, isTerminalState ? (_jsx(GradeGesture, { renderedState: state === "reached" ? "reached" : "not-reached", executionId: walk.executionId, goal: walk.goal ?? "", alreadyGraded: walk.humanGraded, humanReachNotes: walk.humanReachNotes })) : null] })] }))] })] }));
}
//# sourceMappingURL=DetailPanel.js.map