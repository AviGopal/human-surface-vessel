/**
 * The links a record carries: a list of `{url, title?, snippet?}` items, as a
 * web search returns them.
 *
 * Why: a run that stops at search has not answered, but what it found is often
 * the answer one click away (a live gust map, a world clock). On a run that has
 * not reached, those records stay one collapsed line; the links lead instead.
 */
import { CUT_KEY, parsePartialJson } from "./ledger";

export interface FoundLink {
  readonly url: string;
  readonly title: string | null;
  readonly snippet: string | null;
}

const HTTP = /^https?:\/\/[^\s]+$/;
const MAX_DEPTH = 4;

function parsed(v: unknown): unknown {
  if (typeof v !== "string") return v;
  return parsePartialJson(v)?.value ?? null;
}

function asLink(item: unknown): FoundLink | null {
  if (typeof item !== "object" || item === null || Array.isArray(item)) return null;
  const o = item as Record<string, unknown>;
  // A cut item can hold a cut url: only whole items count.
  if (o[CUT_KEY] !== undefined) return null;
  const url = o["url"] ?? o["link"] ?? o["href"];
  if (typeof url !== "string" || !HTTP.test(url)) return null;
  const text = (k: string): string | null => (typeof o[k] === "string" && (o[k] as string).trim() ? (o[k] as string).trim() : null);
  return { url, title: text("title") ?? text("name"), snippet: text("snippet") ?? text("description") };
}

/** The first list of links found in `body` (a preview string or a value), or []. */
export function linksIn(body: unknown, depth = 0): readonly FoundLink[] {
  const v = parsed(body);
  if (depth > MAX_DEPTH || v === null || typeof v !== "object") return [];
  if (Array.isArray(v)) {
    const links = v.map(asLink).filter((l): l is FoundLink => l !== null);
    if (links.length > 0) return links;
  }
  for (const child of Object.values(v as object)) {
    // An envelope's `content` is often the record again, as a JSON string.
    const found = linksIn(typeof child === "string" ? child : child, depth + 1);
    if (found.length > 0) return found;
  }
  return [];
}

/** Links from several records, first occurrence of each url kept. */
export function mergeLinks(lists: readonly (readonly FoundLink[])[]): readonly FoundLink[] {
  const seen = new Set<string>();
  const out: FoundLink[] = [];
  for (const list of lists) {
    for (const l of list) {
      if (seen.has(l.url)) continue;
      seen.add(l.url);
      out.push(l);
    }
  }
  return out;
}
