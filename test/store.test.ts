// Behaviour of the in-memory surface store.
//
// WHY THIS FILE EXISTS. This vessel had no test files at all, and src/store.ts is the
// third most frequently changed uncovered target in the substrate — 45 of 406
// uncovered-target mentions across 400 compose traces. Every change to it landed reviewed
// but never executed, which is the condition the recovery ladder's third rung exists to
// flag. The effect-coverage check reported this vessel as having no test directory, which
// was true.
//
// The assertions below are behavioural: each fails if a contract regresses. Two of them
// cover invariants the source states in prose and nothing enforced — that a broken
// listener must never break a write, and that an upsert preserves the original createdAt
// rather than resetting it.
//
// Dynamic import: loading this module runs a top-level hydrate that reads a log file.
// Importing inside the test keeps that side effect contained and the file self-contained.
import { describe, expect, test } from "bun:test";

const store = await import("../src/store");

describe("asVisibility", () => {
  test("passes through the two legal values", () => {
    expect(store.asVisibility("public", "operator_only")).toBe("public");
    expect(store.asVisibility("operator_only", "public")).toBe("operator_only");
  });

  test("falls back for anything else, including near-misses", () => {
    expect(store.asVisibility(undefined, "public")).toBe("public");
    expect(store.asVisibility(null, "operator_only")).toBe("operator_only");
    expect(store.asVisibility("PUBLIC", "operator_only")).toBe("operator_only");
    expect(store.asVisibility("private", "public")).toBe("public");
    expect(store.asVisibility(42, "public")).toBe("public");
  });
});

describe("rid", () => {
  test("is prefixed and unique across calls", () => {
    const a = store.rid("panel");
    const b = store.rid("panel");
    expect(a.startsWith("panel-")).toBe(true);
    expect(a).not.toBe(b);
  });
});

describe("upsertPanel", () => {
  test("preserves the original createdAt across an update and advances updatedAt", () => {
    const id = store.rid("t-created");
    const first = store.upsertPanel({ id, title: "one", createdAt: 1000 } as never);
    expect(first.createdAt).toBe(1000);

    const second = store.upsertPanel({ id, title: "two" } as never);
    // The whole point of upsert: a later write must not reset the creation time.
    expect(second.createdAt).toBe(1000);
    expect(second.updatedAt).toBeGreaterThanOrEqual(first.updatedAt);
    expect(second.title).toBe("two");
  });

  test("defaults an invalid visibility to public rather than storing it", () => {
    const id = store.rid("t-vis");
    const p = store.upsertPanel({ id, title: "v", visibility: "nonsense" } as never);
    expect(p.visibility).toBe("public");
  });

  test("keeps an explicitly operator_only panel operator_only", () => {
    const id = store.rid("t-vis2");
    const p = store.upsertPanel({ id, title: "v", visibility: "operator_only" } as never);
    expect(p.visibility).toBe("operator_only");
  });
});

describe("subscribe", () => {
  test("delivers events until unsubscribed, and not after", () => {
    const seen: string[] = [];
    const off = store.subscribe((e: { event: string }) => { seen.push(e.event); });

    store.upsertPanel({ id: store.rid("t-sub"), title: "a" } as never);
    expect(seen.length).toBeGreaterThan(0);

    const countAtUnsub = seen.length;
    off();
    store.upsertPanel({ id: store.rid("t-sub"), title: "b" } as never);
    expect(seen.length).toBe(countAtUnsub);
  });

  test("a listener that throws does not break the write", () => {
    // The source states this invariant in a comment and nothing enforced it.
    const off = store.subscribe(() => { throw new Error("deliberately broken listener"); });
    const id = store.rid("t-throw");
    let result: unknown;
    expect(() => { result = store.upsertPanel({ id, title: "survives" } as never); }).not.toThrow();
    expect((result as { title: string }).title).toBe("survives");
    off();
  });

  test("distinguishes a first write from a subsequent one", () => {
    const events: string[] = [];
    const off = store.subscribe((e: { event: string }) => { events.push(e.event); });
    const id = store.rid("t-evt");
    store.upsertPanel({ id, title: "first" } as never);
    store.upsertPanel({ id, title: "again" } as never);
    off();
    expect(events).toContain("panel_added");
    expect(events).toContain("panel_updated");
  });
});

describe("listPanels", () => {
  test("returns panels ordered most-recently-updated first", () => {
    store.upsertPanel({ id: store.rid("t-list"), title: "x" } as never);
    const list = store.listPanels();
    expect(list.length).toBeGreaterThan(0);
    for (let i = 1; i < list.length; i++) {
      expect(list[i - 1]!.updatedAt).toBeGreaterThanOrEqual(list[i]!.updatedAt);
    }
  });
});
