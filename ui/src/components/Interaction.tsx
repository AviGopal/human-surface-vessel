/**
 * The input widgets and the one status footer every interaction shares.
 *
 * Four question kinds (Choice, Score, Noul, Text — plus Number for the store's
 * numeric asks), one set of states: idle, pending (inputs held), sent (with a
 * receipt), failed (the reason, and a retry that re-sends the same thing).
 */

import { useId, type ReactNode } from "react";
import type { InteractionState } from "../lib/interaction";

export function ChoiceInput({
  label,
  options,
  value,
  onChange,
  disabled,
  labels,
}: {
  label: string;
  options: readonly string[];
  value: string | null;
  onChange: (v: string) => void;
  disabled?: boolean;
  /** Display text per option, when it differs from the value. */
  labels?: Readonly<Record<string, string>>;
}): ReactNode {
  const name = useId();
  return (
    <fieldset className="sf-ix-choice" disabled={disabled}>
      <legend className="sf-ix-label">{label}</legend>
      {options.map((option) => (
        <label key={option} className="sf-ix-option" data-checked={value === option}>
          <input type="radio" name={name} value={option} checked={value === option} onChange={() => onChange(option)} />
          <span>{labels?.[option] ?? option}</span>
        </label>
      ))}
    </fieldset>
  );
}

export function ScoreInput({
  label,
  levels,
  legend,
  value,
  onChange,
  disabled,
}: {
  label: string;
  levels: readonly string[];
  legend?: string;
  value: string | null;
  onChange: (v: string) => void;
  disabled?: boolean;
}): ReactNode {
  return (
    <fieldset className="sf-ix-score" disabled={disabled}>
      <legend className="sf-ix-label">
        {label}
        {legend ? <span className="sf-ix-legend"> · {legend}</span> : null}
      </legend>
      <div className="sf-ix-levels" role="radiogroup" aria-label={label}>
        {levels.map((level) => (
          <button
            key={level}
            type="button"
            role="radio"
            aria-checked={value === level}
            className="sf-ix-level"
            onClick={() => onChange(level)}
          >
            {level}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

export function NoulInput({
  statement,
  value,
  onChange,
  disabled,
}: {
  statement: string;
  value: number | null;
  onChange: (v: number) => void;
  disabled?: boolean;
}): ReactNode {
  const id = useId();
  return (
    <fieldset className="sf-ix-noul" disabled={disabled}>
      <legend className="sf-ix-label">“{statement}”</legend>
      <div className="sf-ix-noul-row">
        <button type="button" className="sf-button" aria-pressed={value === 0} onClick={() => onChange(0)}>
          No
        </button>
        <input
          id={id}
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={value ?? 0.5}
          aria-label="How likely is it true"
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <button type="button" className="sf-button" aria-pressed={value === 1} onClick={() => onChange(1)}>
          Yes
        </button>
        <output htmlFor={id} className="sf-ix-noul-value">
          {value === null ? "—" : `${Math.round(value * 100)}%`}
        </output>
      </div>
    </fieldset>
  );
}

export function TextInput({
  label,
  value,
  onChange,
  placeholder,
  disabled,
  format,
  onFormat,
  singleLine,
  mono,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
  format?: "text" | "json";
  onFormat?: (f: "text" | "json") => void;
  singleLine?: boolean;
  mono?: boolean;
}): ReactNode {
  return (
    <div className="sf-ix-text">
      {singleLine ? (
        <input
          aria-label={label}
          className={mono ? "sf-input sf-mono" : "sf-input"}
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <textarea
          aria-label={label}
          className="sf-textarea"
          value={value}
          placeholder={placeholder ?? label}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {onFormat ? (
        <select
          aria-label={`${label} format`}
          className="sf-select sf-select-quiet"
          value={format ?? "text"}
          disabled={disabled}
          onChange={(e) => onFormat(e.target.value as "text" | "json")}
        >
          <option value="text">Text</option>
          <option value="json">JSON</option>
        </select>
      ) : null}
    </div>
  );
}

/** The shared footer: actions on the left, the state on the right. */
export function InteractionFooter({
  state,
  submitLabel,
  canSubmit,
  onSubmit,
  secondary,
  error,
  sentLabel = "Sent",
  receipt,
}: {
  state: InteractionState;
  submitLabel: string;
  canSubmit: boolean;
  onSubmit?: () => void;
  secondary?: ReactNode;
  error?: string | null;
  sentLabel?: string;
  receipt?: ReactNode;
}): ReactNode {
  return (
    <div className="sf-ix-footer">
      <button
        type={onSubmit ? "button" : "submit"}
        className="sf-button sf-button-primary"
        disabled={!canSubmit || state === "pending"}
        onClick={onSubmit}
      >
        {state === "pending" ? "Sending…" : submitLabel}
      </button>
      {secondary}
      <span className="sf-ix-status" role="status" data-state={state}>
        {state === "failed" ? <span className="sf-error-inline">✗ {error ?? "Not delivered"}</span> : null}
        {state === "sent" ? (
          <span className="sf-ok-inline">
            ✓ {sentLabel}
            {receipt ? <span className="sf-ix-receipt"> · {receipt}</span> : null}
          </span>
        ) : null}
        {state !== "failed" && error ? <span className="sf-error-inline">{error}</span> : null}
      </span>
    </div>
  );
}

/** Mutation flags → the one state name. */
export function stateOf(m: { isPending: boolean; isSuccess: boolean; isError: boolean }): InteractionState {
  return m.isPending ? "pending" : m.isError ? "failed" : m.isSuccess ? "sent" : "idle";
}
