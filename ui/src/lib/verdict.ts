/**
 * A verdict line in two parts: the system's code for it, and the text.
 *
 * Deterministic verdicts arrive as `deterministic:hollow_walklog_capped — all 1
 * logged walk step(s)…` or `partial-coverage — reached on a STRICT SUBSET…`.
 * The code is the system's label, not a sentence to a person, so it is drawn
 * as a tag beside the text instead of read as its opening words.
 */
const CODED = /^(?:deterministic:)?([a-z][a-z0-9]*(?:[_-][a-z0-9]+)+|[a-z]+:[a-z0-9_-]+)\s+[\u2014-]+\s+([\s\S]+)$/;

/** One word of a code prefix: `floor`, `floor:upstream-not-reached:`, `deterministic:unsourced-current-information`. */
const CODE_TOKEN = /^[a-z][a-z0-9_-]*(?::[a-z0-9_-]+)*:?$/;
/** Wrapper words that say which checker spoke, not what it found. */
const WRAPPERS = new Set(["floor", "deterministic"]);

/**
 * The finding a token names, without its wrapper: `floor:upstream-not-reached:`
 * gives `upstream-not-reached`; a bare `floor` gives nothing.
 */
function findingOf(token: string): string | null {
  const parts = token.replace(/:$/, "").split(":").filter((x) => !WRAPPERS.has(x));
  return parts.length > 0 ? parts.join(":") : null;
}

export function splitVerdict(text: string): { code: string | null; text: string } {
  const trimmed = text.trim();
  const m = CODED.exec(trimmed);
  if (m) return { code: m[1] ?? null, text: (m[2] ?? "").trim() };
  // A nested prefix: several code words before the dash, e.g. a floor wrapping a
  // deterministic check. Every word before the dash must be a code, or the line is prose.
  const dash = /\s+[\u2014-]+\s+/.exec(trimmed);
  if (!dash || dash.index > 200) return { code: null, text: trimmed };
  const tokens = trimmed.slice(0, dash.index).split(/\s+/);
  if (tokens.length < 2 || !tokens.every((t) => CODE_TOKEN.test(t))) return { code: null, text: trimmed };
  const findings = [...new Set(tokens.map(findingOf).filter((f): f is string => f !== null))];
  return { code: findings.length > 0 ? findings.join(" · ") : null, text: trimmed.slice(dash.index + dash[0].length).trim() };
}
