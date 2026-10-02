/**
 * The human half of the one funnel.
 *
 * The substrate's `ui_legibility_scan` files findings about this surface keyed
 * `ui-feedback-<region>-<kind>`. This control files a human's complaint into the
 * SAME keyspace, differing only in `source: human_reported`. That shared key is
 * the point: it is what lets "the detector found it and nobody complained" and
 * "people complained and the detector was silent" both be computed, and those
 * two questions are the only evidence about whether the detector's rules match
 * what people actually notice.
 *
 * The complaint appears in the gap strip within one poll. It is never
 * auto-closed by the detector — a detector may close its own findings on
 * re-observation, but closing a human's report because its three rules pass
 * would be asserting that the human saw nothing.
 */
import { useState, type ReactNode } from "react";
import { complaintPayload, type ComplaintKind } from "../lib/interaction";
import { ChoiceInput, InteractionFooter, TextInput } from "./Interaction";
import { useQueryClient } from "@tanstack/react-query";

type Kind = ComplaintKind;

const KINDS: ReadonlyArray<{ id: Kind; label: string }> = [
  { id: "hard_to_see", label: "hard to see" },
  { id: "hard_to_understand", label: "hard to understand" },
  { id: "wrong", label: "wrong" },
];

/**
 * `onFiled` fires only after the gap store ACCEPTED the complaint (state
 * "filed"), never on open or on submit: an outcome record for a complaint that
 * failed to file would be a record of an act that did not land.
 */
/** Ask the surface to open the Issues drawer on one issue. Surface listens for this. */
export function showIssue(gapId: string): void {
  window.dispatchEvent(new CustomEvent("sf:show-issue", { detail: gapId }));
}

export function ComplainButton({ region, onFiled }: { region: string; onFiled?: () => void }): ReactNode {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Kind>("hard_to_understand");
  const [text, setText] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "filed" | "failed">("idle");
  const [filedAs, setFiledAs] = useState<string | null>(null);
  const qc = useQueryClient();

  const send = async (): Promise<void> => {
    if (text.trim().length === 0) return;
    setState("sending");
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(complaintPayload({ region, kind, text })),
      });
      if (!res.ok) throw new Error(String(res.status));
      const j = (await res.json().catch(() => null)) as { body?: { filed_gap_id?: unknown } } | null;
      setFiledAs(typeof j?.body?.filed_gap_id === "string" ? j.body.filed_gap_id : null);
      setState("filed");
      setText("");
      onFiled?.();
      // The issue list is the evidence that this landed; refresh it rather than
      // claiming success on our own say-so. The gap is written just after this
      // response returns, so read the list again once it has had time to land.
      void qc.invalidateQueries({ queryKey: ["interfaceGaps"] });
      window.setTimeout(() => void qc.invalidateQueries({ queryKey: ["interfaceGaps"] }), 2500);
    } catch {
      setState("failed");
    }
  };

  if (!open) {
    return (
      <button type="button" className="sf-complain-open" onClick={() => setOpen(true)}>
        Report a problem
      </button>
    );
  }

  return (
    <form
      className="sf-complain sf-interaction"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <ChoiceInput
        label="What kind of problem"
        options={KINDS.map((k) => k.id)}
        labels={Object.fromEntries(KINDS.map((k) => [k.id, k.label]))}
        value={kind}
        onChange={(v) => setKind(v as Kind)}
        disabled={state === "sending"}
      />
      <TextInput label={`What is wrong with ${region}`} placeholder={`What is wrong with “${region}”?`} value={text} onChange={setText} />
      <InteractionFooter
        state={state === "sending" ? "pending" : state === "filed" ? "sent" : state === "failed" ? "failed" : "idle"}
        submitLabel="File"
        canSubmit={text.trim().length > 0}
        error={state === "failed" ? "Not filed" : null}
        sentLabel={filedAs ? `Filed as ${filedAs}` : "Filed"}
        receipt={
          filedAs ? (
            <button type="button" className="sf-link-button" onClick={() => showIssue(filedAs)}>
              show
            </button>
          ) : undefined
        }
        secondary={
          <button type="button" className="sf-button sf-button-quiet" onClick={() => setOpen(false)}>
            Cancel
          </button>
        }
      />
    </form>
  );
}
