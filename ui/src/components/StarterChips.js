import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCapability, useFleetShapes } from "../api/queries";
import { deriveStarters } from "../lib/starters";
const CHIP_LIMIT = 7;
/**
 * The affordance that says this surface is itself changeable by instruction.
 *
 * It is the one starter not derived from the fleet vocabulary, and the comment
 * in `lib/starters.ts` forbidding a hardcoded starter list is worth answering
 * head-on: that rule exists because a fixed list of CAPABILITY examples goes
 * stale the moment the fleet changes and then advertises things that no longer
 * exist. This chip advertises no fleet capability. It names the surface the
 * reader is already looking at, which cannot go stale while they can see it —
 * and the surface genuinely does read its own render policy at use time, so
 * the instruction is one the system can actually act on.
 *
 * It INSERTS, like every other chip. `StarterChips` has no dispatch mutation
 * in scope at all, so P2 is structural here rather than a promise.
 */
const SELF_STARTER = {
    label: "change this surface",
    text: "Change this surface itself: make the labels on the human surface bigger. Write the new type-scale values as render-policy token overrides, which this page reads at use time — ",
};
function SelfChip({ onInsert }) {
    return (_jsx("button", { type: "button", className: "sf-chip", "data-kind": "self", title: "This surface can be changed by asking. Fills the box \u2014 it does not send.", onClick: () => onInsert(SELF_STARTER.text), children: SELF_STARTER.label }));
}
function Chip({ starter, onInsert }) {
    // Producer verification REFINES a chip that is already on screen. It never
    // gates the first paint: a surface that waits on N capability lookups before
    // showing a single suggestion has rebuilt the blank box it exists to remove.
    const capability = useCapability(starter.shape, true);
    // THREE states, not two. `capability.data === true` collapsed "the lookup
    // has not answered" into "confirmed absent", so every chip rendered dashed
    // and the legend under them — "a dashed chip has no confirmed producer" —
    // was unfalsifiable: with no solid chip anywhere on screen that sentence
    // carried no information at all. A chip goes dashed only on a confirmed
    // negative; not-yet-known says so, and says it more quietly.
    const producer = capability.data === true ? "live" : capability.data === false ? "unverified" : "unknown";
    const TITLE = {
        live: `A vessel is advertising ${starter.shape} right now`,
        unverified: `Derived from ${starter.shape}; discovery confirmed no live producer for it`,
        unknown: `Derived from ${starter.shape}; this surface has not been able to check for a producer yet`,
    };
    return (_jsx("button", { type: "button", className: "sf-chip", "data-producer": producer, title: TITLE[producer], onClick: () => onInsert(starter.text), children: starter.label }));
}
export function StarterChips({ onInsert }) {
    const shapes = useFleetShapes();
    // The self chip survives both of the degraded branches below on purpose: it
    // does not depend on the fleet vocabulary, and the state where this surface
    // cannot read the fleet is exactly the state in which "you can change this
    // surface by asking" is most worth knowing.
    if (shapes.isError) {
        return (_jsxs(_Fragment, { children: [_jsx("p", { className: "sf-note sf-muted", style: { marginTop: "var(--sf-space-3)" }, children: "The fleet's shape list could not be read, so there are no suggestions \u2014 not because the system can do nothing, but because this surface cannot currently see what it does. Type what you want; the walk does not depend on this list." }), _jsx("div", { className: "sf-chips", children: _jsx(SelfChip, { onInsert: onInsert }) })] }));
    }
    if (!shapes.data) {
        return (_jsxs(_Fragment, { children: [_jsx("p", { className: "sf-note sf-muted", style: { marginTop: "var(--sf-space-3)" }, children: "Reading what the fleet can produce\u2026" }), _jsx("div", { className: "sf-chips", children: _jsx(SelfChip, { onInsert: onInsert }) })] }));
    }
    const starters = deriveStarters(shapes.data, CHIP_LIMIT);
    // Shapes were read, and none of them can be a human's goal. This is a real
    // state, not a degraded one: the local registry alone advertises 16 shapes
    // and all 16 are machine plumbing, so when the fleet leg cannot be read this
    // is exactly what is left. Saying so beats offering `interactor assertion` as
    // a suggestion — and beats an unexplained empty row, which reads as breakage.
    if (starters.length === 0) {
        return (_jsxs(_Fragment, { children: [_jsxs("p", { className: "sf-note sf-muted", style: { marginTop: "var(--sf-space-3)" }, children: ["The ", shapes.data.length, " shapes currently visible are all internal plumbing \u2014 none of them is something a person would ask for, so there are no suggestions to make. That usually means the wider fleet's vocabulary is not being read right now. Type what you want; the walk does not depend on this list."] }), _jsx("div", { className: "sf-chips", children: _jsx(SelfChip, { onInsert: onInsert }) })] }));
    }
    return (_jsxs(_Fragment, { children: [_jsxs("div", { className: "sf-chips", children: [starters.map((starter) => (_jsx(Chip, { starter: starter, onInsert: onInsert }, starter.id))), _jsx(SelfChip, { onInsert: onInsert })] }), _jsxs("p", { className: "sf-note sf-muted", style: { marginTop: "var(--sf-space-2)" }, children: ["Derived from the ", shapes.data.length, " shapes the fleet is advertising right now \u00B7 clicking fills the box, it does not send \u00B7 a dashed chip is one discovery confirmed has no producer, a faded chip is one this surface could not check \u00B7 the accented chip changes this page itself"] })] }));
}
//# sourceMappingURL=StarterChips.js.map