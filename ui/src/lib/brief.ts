/**
 * A DECISION BRIEF: what the system leaves to the person, as one content form.
 *
 * The shape is `{asOf, items:[{questionId, subject, ask, whyYou, evidence:[{label, value, source}],
 * options:[{label, effect}]}]}`; snake_case aliases are read too (`as_of`, `question_id`, `why_you`). It is
 * recognised by its STRUCTURE, never by the impulse's shape name, like every other form here (the surface
 * dispatches on form and treats the shape as a badge): any producer's output that carries this structure
 * is a brief.
 *
 * Positive evidence only. An item missing `questionId` or `ask` VOIDS the brief: the content is then not a
 * brief and is drawn as the record it is, never as a brief with holes. `{asOf, items:[]}` IS a brief, the one
 * that says nothing needs the person now.
 */

export interface BriefEvidence {
  readonly label: string;
  readonly value: string;
  readonly source: string;
}
export interface BriefOption {
  readonly label: string;
  readonly effect: string;
}
export interface BriefItem {
  readonly questionId: string;
  readonly subject: string;
  readonly ask: string;
  readonly whyYou: string;
  readonly evidence: readonly BriefEvidence[];
  readonly options: readonly BriefOption[];
}
export interface Brief {
  readonly asOf: string | null;
  readonly items: readonly BriefItem[];
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The first of `keys` that holds a value, as text ("" when none). Numbers and booleans are written out. */
function textOf(o: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string") return v;
    if (typeof v === "number" || typeof v === "boolean") return String(v);
  }
  return "";
}

function listOf(o: Record<string, unknown>, key: string): Record<string, unknown>[] {
  const v = o[key];
  return Array.isArray(v) ? v.filter(isObject) : [];
}

/** The brief a parsed value carries, or null when it is not one (see the header). */
export function parseBrief(value: unknown): Brief | null {
  if (!isObject(value) || !Array.isArray(value["items"])) return null;
  if (!("asOf" in value) && !("as_of" in value)) return null;
  const items: BriefItem[] = [];
  for (const raw of value["items"] as unknown[]) {
    if (!isObject(raw)) return null;
    const questionId = textOf(raw, "questionId", "question_id").trim();
    const ask = textOf(raw, "ask").trim();
    if (!questionId || !ask) return null;
    items.push({
      questionId,
      subject: textOf(raw, "subject"),
      ask,
      whyYou: textOf(raw, "whyYou", "why_you"),
      evidence: listOf(raw, "evidence").map((e) => ({ label: textOf(e, "label"), value: textOf(e, "value"), source: textOf(e, "source") })),
      options: listOf(raw, "options").map((p) => ({ label: textOf(p, "label"), effect: textOf(p, "effect") })),
    });
  }
  const asOf = textOf(value, "asOf", "as_of");
  return { asOf: asOf || null, items };
}

/** The brief a JSON text carries, or null (unparseable, or not a brief). */
export function parseBriefText(text: string): Brief | null {
  try {
    return parseBrief(JSON.parse(text.trim()));
  } catch {
    return null;
  }
}
