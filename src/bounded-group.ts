/**
 * A group of named whole numbers carried on the render policy, each with a bootstrap default
 * and a range the guard holds it to (`recheck`, `limits`). One reading for every group:
 *
 * - a patch merges key by key, so a key it does not name keeps the value in force; every key
 *   is a plain number, so there is no inner map a merge could fail to remove;
 * - a key not read, or a value outside its range, is refused by name in `rejected`;
 * - a stored or served group is read whole, each missing or junk key as its default.
 */
export interface BoundedGroup<K extends string> {
  readonly name: string;
  readonly keys: readonly K[];
  readonly defaults: Readonly<Record<K, number>>;
  readonly ranges: Readonly<Record<K, readonly [number, number]>>;
  /** The keys of a patch the guard reads; undefined when the patch carries nothing to read. */
  patch(raw: unknown, rejected: string[]): Partial<Record<K, number>> | undefined;
  /** A whole group from whatever was stored or served. */
  of(raw: unknown): Readonly<Record<K, number>>;
}

export function boundedGroup<K extends string>(
  name: string,
  defaults: Readonly<Record<K, number>>,
  ranges: Readonly<Record<K, readonly [number, number]>>,
): BoundedGroup<K> {
  const keys = Object.keys(defaults) as K[];
  const inRange = (key: K, v: unknown): v is number => {
    const [lo, hi] = ranges[key];
    return typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;
  };
  return {
    name,
    keys,
    defaults,
    ranges,
    patch(raw, rejected) {
      if (raw === undefined) return undefined;
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        rejected.push(`${name} must be an object of whole numbers`);
        return undefined;
      }
      const out: Partial<Record<K, number>> = {};
      for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
        if (!(keys as readonly string[]).includes(k)) {
          rejected.push(`${name}.${k} is not read; the keys are ${keys.join(", ")}`);
          continue;
        }
        const key = k as K;
        if (!inRange(key, v)) {
          const [lo, hi] = ranges[key];
          rejected.push(`${name}.${key} must be an integer from ${lo} to ${hi}`);
          continue;
        }
        out[key] = v;
      }
      return Object.keys(out).length > 0 ? out : undefined;
    },
    of(raw) {
      const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
      return Object.fromEntries(keys.map((k) => [k, inRange(k, r[k]) ? r[k] : defaults[k]])) as Record<K, number>;
    },
  };
}
