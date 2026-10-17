/**
 * Task 11 prototype (interface-as-shapes): a view as data, drawn from a closed set
 * of primitives. Two candidate wire formats decode to this one tree:
 *   - nested: the in-house sketch (`{ primitive, bind, props, children }`);
 *   - A2UI v0.9 `updateComponents`: a flat list of `{ id, component, … }`
 *     linked by id, with `{ path }` JSON Pointer bindings into a data model.
 * Either way, an unknown primitive, a bad prop or an unresolvable binding fails
 * the whole view, and the region falls back to its default.
 */

export const PRIMITIVES = {
  Stack: { props: [], children: true },
  Heading: { props: ["text"], children: false },
  Text: { props: ["text"], children: false },
  Mark: { props: ["text"], children: false },
  Fold: { props: ["label"], children: true },
} as const;
export type Primitive = keyof typeof PRIMITIVES;

/** A prop is a literal string or a JSON Pointer into the drawn context. */
export type Value = string | { readonly path: string };

export interface ViewNode {
  readonly primitive: Primitive;
  readonly props: Readonly<Record<string, Value>>;
  readonly children: readonly ViewNode[];
}

export type Decoded = { ok: true; root: ViewNode } | { ok: false; error: string };

const isValue = (v: unknown): v is Value =>
  typeof v === "string" || (typeof v === "object" && v !== null && typeof (v as { path?: unknown }).path === "string");

function node(primitive: unknown, props: Record<string, unknown>, children: ViewNode[]): ViewNode | string {
  if (typeof primitive !== "string" || !(primitive in PRIMITIVES)) return `unknown primitive ${JSON.stringify(primitive)}`;
  const spec = PRIMITIVES[primitive as Primitive];
  const out: Record<string, Value> = {};
  for (const [k, v] of Object.entries(props)) {
    if (!(spec.props as readonly string[]).includes(k)) return `${primitive} has no prop "${k}"`;
    if (!isValue(v)) return `${primitive}.${k} is not text or a {path}`;
    out[k] = v;
  }
  if (!spec.children && children.length > 0) return `${primitive} takes no children`;
  return { primitive: primitive as Primitive, props: out, children };
}

/** The in-house nested format. */
export function decodeNested(v: unknown, depth = 0): Decoded {
  if (depth > 12) return { ok: false, error: "too deep" };
  if (!v || typeof v !== "object") return { ok: false, error: "a node must be an object" };
  const { primitive, props = {}, children = [] } = v as { primitive?: unknown; props?: Record<string, unknown>; children?: unknown[] };
  const kids: ViewNode[] = [];
  for (const c of Array.isArray(children) ? children : []) {
    const d = decodeNested(c, depth + 1);
    if (!d.ok) return d;
    kids.push(d.root);
  }
  const n = node(primitive, props, kids);
  return typeof n === "string" ? { ok: false, error: n } : { ok: true, root: n };
}

/** A2UI v0.9 `updateComponents.components`, rooted at the component with id "root". */
export function decodeA2ui(components: unknown): Decoded {
  if (!Array.isArray(components)) return { ok: false, error: "components must be an array" };
  const byId = new Map<string, Record<string, unknown>>();
  for (const c of components) {
    const id = (c as { id?: unknown })?.id;
    if (typeof id !== "string" || byId.has(id)) return { ok: false, error: `bad or duplicate id ${JSON.stringify(id)}` };
    byId.set(id, c as Record<string, unknown>);
  }
  const seen = new Set<string>();
  const build = (id: string): ViewNode | string => {
    const c = byId.get(id);
    if (!c) return `no component "${id}"`;
    if (seen.has(id)) return `component "${id}" is reached twice`;
    seen.add(id);
    const { id: _id, component, child, children, ...props } = c;
    const ids = typeof child === "string" ? [child] : Array.isArray(children) ? children : [];
    const kids: ViewNode[] = [];
    for (const k of ids) {
      const n = typeof k === "string" ? build(k) : "children must be ids";
      if (typeof n === "string") return n;
      kids.push(n);
    }
    return node(component, props, kids);
  };
  const root = build("root");
  return typeof root === "string" ? { ok: false, error: root } : { ok: true, root };
}

/** RFC 6901 JSON Pointer. */
export function resolvePointer(data: unknown, path: string): unknown {
  if (path === "" || path === "/") return data;
  if (!path.startsWith("/")) return undefined;
  let at: unknown = data;
  for (const raw of path.slice(1).split("/")) {
    const key = raw.replace(/~1/g, "/").replace(/~0/g, "~");
    if (at === null || typeof at !== "object" || !(key in (at as object))) return undefined;
    at = (at as Record<string, unknown>)[key];
  }
  return at;
}

/** Every binding resolves to text, or the view fails. */
export function bindText(v: Value, data: unknown): string | null {
  if (typeof v === "string") return v;
  const r = resolvePointer(data, v.path);
  return typeof r === "string" || typeof r === "number" ? String(r) : null;
}
