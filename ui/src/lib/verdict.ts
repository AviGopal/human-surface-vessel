/**
 * A verdict line in two parts: the system's code for it, and the text.
 *
 * Deterministic verdicts arrive as `deterministic:hollow_walklog_capped — all 1
 * logged walk step(s)…` or `partial-coverage — reached on a STRICT SUBSET…`.
 * The code is the system's label, not a sentence to a person, so it is drawn
 * as a tag beside the text instead of read as its opening words.
 */
const CODED = /^(?:deterministic:)?([a-z][a-z0-9]*(?:[_-][a-z0-9]+)+|[a-z]+:[a-z0-9_-]+)\s+[\u2014-]+\s+([\s\S]+)$/;

export function splitVerdict(text: string): { code: string | null; text: string } {
  const m = CODED.exec(text.trim());
  if (!m) return { code: null, text: text.trim() };
  return { code: m[1] ?? null, text: (m[2] ?? "").trim() };
}
