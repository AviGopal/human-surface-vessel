/**
 * The page names no section and carries no grouping rule: what the landing shows, in what
 * order and under what title, is the view's (src/ui-views.ts). A filter the landing needs is
 * a pointer argument its producer honours, as `uiQuestion {open: true}` is for "what waits on
 * a person", not code in the page.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { testAuth } from "./setup.ts";
import { impulsesRouter } from "../src/routes/impulses.ts";

const ui = new URL("../ui/src/", import.meta.url).pathname;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.tsx?$/.test(name) && !name.endsWith(".d.ts") ? [p] : [];
  });
}

/** Names the landing's fixed sections went by, and the code that chose between them. */
const SECTION_NAMES = /needs_you|"Needs you"|>Needs you<|"The system"|>The system<|LANDING_BLOCKS|landingBlocks|data-block\b|DEFAULT_LANDING/;

describe("no named sections", () => {
  test("must-fail: no page source names a landing section or holds a landing default", () => {
    const hits = sources(ui).flatMap((f) => (SECTION_NAMES.test(readFileSync(f, "utf8")) ? [f.slice(ui.length)] : []));
    expect(hits).toEqual([]);
  });

  test("must-fail: the landing and the entries it draws choose, filter and order nothing", () => {
    for (const f of ["components/Landing.tsx", "components/Reports.tsx"]) {
      const src = readFileSync(join(ui, f), "utf8");
      expect(src).not.toMatch(/\.filter\(|\.sort\(|classifyQuestion|\bordered\b/);
    }
  });

  test("must-fail: the view store holds no block vocabulary", () => {
    const src = readFileSync(new URL("../src/ui-views.ts", import.meta.url).pathname, "utf8");
    expect(src).not.toMatch(/needs_you|VIEW_LIMITS|LandingBlock/);
  });
});

describe("uiQuestion {open: true} is what waits on a person", () => {
  async function resolve(pointer: Record<string, unknown>) {
    const r = await impulsesRouter.request("/v2/impulses/resolve", {
      method: "POST", headers: { "content-type": "application/json", ...testAuth() }, body: JSON.stringify({ pointer }),
    });
    return { status: r.status, json: (await r.json()) as any };
  }
  // The store is shared across the suite, so read every question, not the policy slice.
  const ids = (j: any): string[] => (j.body.questions as { id: string }[]).map((q) => q.id).filter((id) => id.startsWith("nns-"));

  test("must-fail: a notice is left out with open, and kept without it", async () => {
    expect((await resolve({ type: "uiQuestion_write", id: "nns-ask", title: "Which branch ships?", kind: "question", asks: [{ id: "a1", prompt: "Which branch?", type: "text" }] })).status).toBe(200);
    expect((await resolve({ type: "uiQuestion_write", id: "nns-notice", title: "The nightly run finished", kind: "notice", body: "Nothing to decide." })).status).toBe(200);
    const all = await resolve({ type: "uiQuestion", visible_slice_size: null });
    expect(ids(all.json).sort()).toEqual(["nns-ask", "nns-notice"]);
    const open = await resolve({ type: "uiQuestion", open: true, visible_slice_size: null });
    expect(ids(open.json)).toEqual(["nns-ask"]);
  });
});
