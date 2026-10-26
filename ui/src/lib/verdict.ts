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
  if (dash && dash.index <= 200) {
    const tokens = trimmed.slice(0, dash.index).split(/\s+/);
    if (tokens.length >= 2 && tokens.every((t) => CODE_TOKEN.test(t))) {
      const findings = [...new Set(tokens.map(findingOf).filter((f): f is string => f !== null))];
      return { code: findings.length > 0 ? findings.join(" · ") : null, text: trimmed.slice(dash.index + dash[0].length).trim() };
    }
  }
  // No dash: a run of code words whose last one ends in a colon, then the sentence
  // ("floor floor:upstream-not-reached: The output…").
  const words = trimmed.split(/\s+/);
  let i = 0;
  while (i < words.length && CODE_TOKEN.test(words[i]!) && !words[i]!.endsWith(":")) i++;
  const namespaced = i < words.length && (i >= 1 || words[i]!.slice(0, -1).includes(":"));
  if (namespaced && words[i]!.endsWith(":") && CODE_TOKEN.test(words[i]!) && i + 1 < words.length && /[\p{Lu}]/u.test(words[i + 1]![0] ?? "")) {
    const findings = [...new Set(words.slice(0, i + 1).map(findingOf).filter((f): f is string => f !== null))];
    if (findings.length > 0) return { code: findings.join(" · "), text: words.slice(i + 1).join(" ") };
  }
  return { code: null, text: trimmed };
}

/**
 * goal-host prefixes the reason with the person's verdict when a person's grade
 * overrode the judge: `[human override: <the person's words>] <the judge's reason>`.
 * The person's words are their line, and the rest is the judge's; left together,
 * the leading bracket reads as structured data and the whole reason is drawn as code.
 */
const OVERRIDE = /^\[human override:\s*([^\]]*)\]\s*/;

export function splitOverride(reason: string): { person: string | null; judge: string } {
  const m = OVERRIDE.exec(reason.trim());
  if (!m) return { person: null, judge: reason.trim() };
  return { person: (m[1] ?? "").trim() || null, judge: reason.trim().slice(m[0].length).trim() };
}
