import { labelKeyId } from "./inbound-auth.ts";

/** What a row a person wrote names as its writer, to a viewer who has not signed in. */
export const A_PERSON = "a person";

/**
 * A row a person wrote names "a person" as its writer, not the person's key id, to every viewer
 * but that person: whoever can open the page is not thereby someone the person told who they
 * are. `own` is the signed-in viewer's key id (a key sign-in's userId, the id records stamps as
 * the writer), or null. Which rows are a person's is records' `role`, stamped from the writer's key.
 * The same holds for what this node stamped from a key's label (inbound-auth.ts `keyLabel`): an
 * answer's `caller.label`, a question's `producer`, a view's `writtenBy`; and for the session id a
 * sign-in is recorded under (`user_id`). The stamp keeps the key id, since undo reads it as the
 * writer's identity; only what a viewer is sent is unnamed.
 */
export function unnamePeople(v: unknown, own: string | null): unknown {
  if (Array.isArray(v)) return v.map((x) => unnamePeople(x, own));
  if (typeof v !== "object" || v === null) return v;
  const o = Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, unnamePeople(x, own)]));
  const other = (label: unknown): boolean => {
    const id = typeof label === "string" ? labelKeyId(label) : null;
    return id !== null && id !== own;
  };
  const caller = o["caller"] as Record<string, unknown> | null | undefined;
  return {
    ...o,
    ...(o["role"] === "person" && "writer" in o && o["writer"] !== own ? { writer: A_PERSON } : {}),
    ...Object.fromEntries(LABEL_STAMPS.filter((k) => other(o[k])).map((k) => [k, A_PERSON])),
    ...(typeof caller === "object" && caller !== null && other(caller["label"]) ? { caller: { ...caller, label: A_PERSON } } : {}),
    ...(typeof o["user_id"] === "string" && o["user_id"] !== own ? { user_id: A_PERSON } : {}),
  };
}

/** The fields this node stamps with a caller's label, beside `caller.label`. */
const LABEL_STAMPS = ["producer", "writtenBy", "written_by"] as const;

/** A read's answer with every other person's writer unnamed; an answer that is not JSON passes as it came. */
export async function unnamed(res: Response, own: string | null): Promise<Response> {
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return new Response(text, { status: res.status, headers: res.headers });
  }
  return new Response(JSON.stringify(unnamePeople(body, own)), { status: res.status, headers: res.headers });
}
