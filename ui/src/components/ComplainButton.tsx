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
import { useQueryClient } from "@tanstack/react-query";

type Kind = "hard_to_see" | "hard_to_understand" | "wrong";

const KINDS: ReadonlyArray<{ id: Kind; label: string }> = [
  { id: "hard_to_see", label: "hard to see" },
  { id: "hard_to_understand", label: "hard to understand" },
  { id: "wrong", label: "wrong" },
];

export function ComplainButton({ region }: { region: string }): ReactNode {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Kind>("hard_to_understand");
  const [text, setText] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "filed" | "failed">("idle");
  const qc = useQueryClient();

  const send = async (): Promise<void> => {
    if (text.trim().length === 0) return;
    setState("sending");
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ panel_id: region, kind, value: text.trim() }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setState("filed");
      setText("");
      // The gap strip is the evidence that this landed; refresh it rather than
      // claiming success on our own say-so.
      void qc.invalidateQueries({ queryKey: ["interfaceGaps"] });
      window.setTimeout(() => setOpen(false), 2200);
    } catch {
      setState("failed");
    }
  };

  if (!open) {
    return (
      <button type="button" className="sf-complain-open" onClick={() => setOpen(true)}>
        something's wrong here
      </button>
    );
  }

  return (
    <div className="sf-complain">
      <div className="sf-complain-kinds" role="group" aria-label="what kind of problem">
        {KINDS.map((k) => (
          <button
            key={k.id}
            type="button"
            className="sf-complain-kind"
            aria-pressed={kind === k.id}
            onClick={() => setKind(k.id)}
          >
            {k.label}
          </button>
        ))}
      </div>
      <textarea
        className="sf-complain-text"
        value={text}
        placeholder={`what is wrong with “${region}”?`}
        aria-label={`what is wrong with ${region}`}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="sf-complain-actions">
        <button type="button" className="sf-button sf-button-primary" onClick={() => void send()} disabled={state === "sending"}>
          {state === "sending" ? "filing…" : "file it"}
        </button>
        <button type="button" className="sf-button sf-button-quiet" onClick={() => setOpen(false)}>
          cancel
        </button>
        {state === "filed" ? (
          <span className="sf-complain-note">
            Filed as an open gap on this interface — it appears below, and the substrate's own
            detector will never close it for you.
          </span>
        ) : null}
        {state === "failed" ? (
          <span className="sf-complain-note sf-complain-failed">
            Not filed — the gap store did not accept it. Nothing was recorded.
          </span>
        ) : null}
      </div>
    </div>
  );
}
