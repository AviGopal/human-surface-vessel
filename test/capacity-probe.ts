/**
 * DOES THE LAYOUT FIT ITS CONTENT? Measured, at two corpus sizes.
 *
 * The operator's question, in four parts: can the interface handle this many
 * requests; how does it handle them; are some regions too small for their
 * content while others are too large; and what happens when the content
 * changes. None of that is answerable by reading CSS, because the answer is a
 * ratio between two numbers the browser computes at paint time.
 *
 * So for every region this measures, per corpus size:
 *   allocated = clientHeight  — the space the grid gave it
 *   content   = scrollHeight  — the space its content wanted
 *   pressure  = content / allocated
 *
 * pressure > 1 means the region is SMALLER than its content and something is
 * only reachable by scrolling inside it. pressure well under 1 means the region
 * was given space it is not using — and on a one-page layout that space was
 * taken FROM the regions above 1. Both are reported; neither is assumed to be
 * the defect.
 *
 * It also records how many solicitation rows are actually inside the list's
 * viewport box, because "the surface handles 248 requests" and "a person can
 * see 248 requests" are different claims and only the second one matters to a
 * human.
 *
 * WHAT THIS CANNOT SAY: whether the allocation is WRONG. A region can be
 * pressured and correct (a 74KB payload should scroll, not resize the page) and
 * a region can be roomy and correct (an input that must not jump). The
 * numbers locate the question; they do not settle it.
 *
 * RUN (redirection, never a pipe):
 *   PLAYWRIGHT_MODULE=... CHROMIUM_EXECUTABLE=... \
 *   bun repos/human-surface-vessel/test/capacity-probe.ts > /tmp/cap.txt 2>&1; echo "RC=$?"
 */
import { mkdtempSync, rmSync } from "node:fs";

const workspace = mkdtempSync("/tmp/capacity-probe-");
process.env.WORKSPACE_ROOT = workspace;
const root = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const { impulsesRouter } = await import(root + "/src/routes/impulses.ts");
const { participationRouter } = await import(root + "/src/routes/participation.ts");
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");

/** Matches the live escalation corpus discovered in the retired vessel. */
const LOADED = 248;
const LIGHT = 3;

const VIEWPORTS = [
  { name: "1440x900 (laptop)", width: 1440, height: 900 },
  { name: "1920x1080 (desktop)", width: 1920, height: 1080 },
];

/**
 * A body of the shape the real escalations carry, so the measurement is not of
 * a toy string. Taken from the live `needs-human-*` panels.
 */
function escalationBody(i: number): string {
  return (
    `Gap reach-gap-example-${i} (unreachable_producer) has failed auto-repair 8+ times with 0 lands. ` +
    `It likely needs a human response: redefine the goal, provide missing information, grant access, ` +
    `or drop it. Summary: Reachability gap: a shape is advertised by a producer, but the walk could ` +
    `not reach it from cold — the producer's required inputs are themselves unreachable.`
  );
}

async function seed(count: number): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    const res = await impulsesRouter.request("/v2/impulses/resolve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        pointer: {
          type: "uiQuestion_write",
          id: `cap-${i}`,
          title: `Gap needs a human decision — reach-gap-example-${i}`,
          kind: "gap_needs_human",
          body: escalationBody(i),
          asks: [{ id: `cap-${i}-a1`, prompt: "Redefine, provide information, grant access, or drop?" }],
        },
      }),
    });
    if (res.status !== 200) throw new Error(`seeding cap-${i} returned ${res.status}`);
  }
}

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/api/questions") return participationRouter.fetch(request);
    if (path === "/api/participation") return participationRouter.fetch(request);
    if (path === "/api/observations") return Response.json({ ok: true });
    if (path === "/api/feedback") return Response.json({ ok: true });
    if (path === "/api/render-policy") {
      return Response.json({
        tokenOverrides: {}, formByShape: {}, presentation: "onepage",
        revision: 1, updatedAt: 0, note: "capacity probe",
      });
    }
    if (path === "/api/discovery/shapes") return Response.json({ shapes: [] });
    if (path === "/api/resolve") return Response.json({ resolved: true, body: { dispatches: [] } });
    if (path.startsWith("/api/")) return Response.json({ gaps: [] });
    const file = Bun.file(root + "/ui/dist" + (path === "/" ? "/index.html" : path));
    if (!(await file.exists())) return new Response("not found", { status: 404 });
    return new Response(file);
  },
});

interface RegionMeasure {
  region: string;
  allocated: number;
  content: number;
  pressure: number;
  scrolls: boolean;
  node: string;
}

const REGION_SELECTORS: Record<string, string> = {
  ask: ".sf-ask",
  questions: ".sf-participation",
  runs: ".sf-runs",
  detail: ".sf-detail",
  gaps: ".sf-gaps",
};

let browser;
let failed = false;
try {
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_EXECUTABLE,
    args: ["--no-sandbox"],
  });

  for (const [phase, count] of [["LIGHT", LIGHT], ["LOADED", LOADED]] as const) {
    if (phase === "LIGHT") await seed(LIGHT);
    else await seed(LOADED - LIGHT);

    for (const vp of VIEWPORTS) {
      const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(`http://127.0.0.1:${server.port}`, { waitUntil: "domcontentloaded" });
      await page.getByRole("region", { name: "Questions for you", exact: true }).waitFor({ timeout: 20_000 });
      await page.waitForFunction(() => document.documentElement.dataset["presentation"] !== undefined);
      await page.waitForFunction(() => document.querySelectorAll("[data-solicitation-id]").length > 0);

      const measured = await page.evaluate((selectors: Record<string, string>) => {
        /*
         * MEASURE THE SCROLLER, NOT THE BOX THAT CLIPS IT.
         *
         * The first version of this probe picked a named inner element per
         * region and compared its clientHeight to its scrollHeight. For a
         * region whose inner element IS the clipping box, those two are equal
         * by definition, so every region reported pressure exactly 1.00 — and
         * the giveaway was that 248 panels produced the same content height as
         * 3, which cannot happen when the row count goes 3 -> 50. A ratio of
         * exactly 1 across the board is an instrument reading itself.
         *
         * So: walk the region's subtree, find every element that actually
         * overflows (scrollHeight > clientHeight) or is scrollable, and report
         * the one under the most pressure along with the region's own box.
         */
        const out: Record<string, { allocated: number; content: number; scrolls: boolean; node: string }> = {};
        for (const [name, sel] of Object.entries(selectors)) {
          const region = document.querySelector(sel) as HTMLElement | null;
          if (!region) continue;
          let worst = { allocated: region.clientHeight, content: region.scrollHeight, scrolls: false, node: sel };
          const all = [region, ...Array.from(region.querySelectorAll<HTMLElement>("*"))];
          for (const el of all) {
            if (el.clientHeight <= 0) continue;
            // Screen-reader-only text is clipped to ~1px BY DESIGN, so it
            // reports a huge ratio and is not a layout finding. Excluded by
            // class and by an absolute floor, because a region under real
            // pressure is never 8px tall.
            if (el.clientHeight < 8) continue;
            if (/visually-hidden|sr-only/.test(String(el.className))) continue;
            const oy = getComputedStyle(el).overflowY;
            const scrollable = oy === "auto" || oy === "scroll";
            const ratio = el.scrollHeight / el.clientHeight;
            const worstRatio = worst.allocated > 0 ? worst.content / worst.allocated : 0;
            if (ratio > worstRatio) {
              worst = {
                allocated: el.clientHeight,
                content: el.scrollHeight,
                scrolls: scrollable,
                node: el.className ? "." + String(el.className).split(/\s+/)[0] : el.tagName.toLowerCase(),
              };
            }
          }
          out[name] = worst;
        }
        return out;
      }, REGION_SELECTORS);

      const rows = await page.evaluate((height: number) => {
        const list = document.querySelector(".sf-question-list") as HTMLElement | null;
        const all = Array.from(document.querySelectorAll<HTMLElement>("[data-solicitation-id]"));
        if (!list) return { inDom: all.length, inView: 0 };
        const lb = list.getBoundingClientRect();
        const top = Math.max(0, lb.top + list.clientTop);
        const bottom = Math.min(height, lb.top + list.clientTop + list.clientHeight);
        let inView = 0;
        for (const el of all) {
          const b = el.getBoundingClientRect();
          const visible = Math.max(0, Math.min(b.bottom, bottom) - Math.max(b.top, top));
          if (b.height > 0 && visible / b.height > 0.5) inView += 1;
        }
        return { inDom: all.length, inView };
      }, vp.height);

      const served = await page.evaluate(async () => {
        const res = await fetch("/api/questions", { credentials: "same-origin" });
        const body = (await res.json()) as { body?: { total?: number; ranking?: Record<string, unknown> } };
        return { total: body.body?.total ?? null, ranking: body.body?.ranking ?? null };
      });

      const pageScrolls = await page.evaluate(() => ({
        v: document.documentElement.scrollHeight > document.documentElement.clientHeight + 1,
        h: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      }));

      const sliceLine = await page.locator(".sf-participation-slice").count();

      console.log(`\n════ ${phase} corpus (${count === LIGHT ? LIGHT : LOADED} panels) · ${vp.name}`);
      console.log(`  served: total=${String(served.total)}  ranking=${JSON.stringify(served.ranking && {
        shown: (served.ranking as Record<string, unknown>)["shown_count"],
        not_shown: (served.ranking as Record<string, unknown>)["not_shown_count"],
        slice_size: (served.ranking as Record<string, unknown>)["slice_size"],
      })}`);
      console.log(`  rows: ${rows.inDom} in DOM, ${rows.inView} more than half inside the list viewport`);
      console.log(`  withholding line rendered: ${sliceLine > 0 ? "YES" : "no"}`);
      console.log(`  page scroll: vertical=${pageScrolls.v} horizontal=${pageScrolls.h}  (one-page invariant: both must be false)`);
      const table: RegionMeasure[] = Object.entries(measured).map(([region, m]) => ({
        region,
        allocated: m.allocated,
        content: m.content,
        pressure: m.allocated > 0 ? Number((m.content / m.allocated).toFixed(2)) : Number.NaN,
        scrolls: m.scrolls,
        node: m.node,
      }));
      for (const r of table.sort((a, b) => b.pressure - a.pressure)) {
        const verdict =
          r.pressure > 1.05 ? (r.scrolls ? "pressured (scrolls internally)" : "OVERFLOWING, no inner scroll")
          : r.pressure < 0.6 ? "roomy — holding space it does not use"
          : "fits";
        console.log(
          `    ${r.region.padEnd(10)} allocated ${String(r.allocated).padStart(5)}px  content ${String(r.content).padStart(6)}px  pressure ${String(r.pressure).padStart(6)}  ${verdict.padEnd(31)} at ${r.node}`,
        );
      }
      if (errors.length) { console.log(`  PAGE ERRORS: ${errors.join(" | ")}`); failed = true; }
      if (pageScrolls.v || pageScrolls.h) { console.log("  FAIL: the page itself scrolls — the one-page invariant broke"); failed = true; }
      await page.close();
    }
  }
} catch (error) {
  failed = true;
  console.error(`FAIL capacity: ${(error as Error).message}`);
} finally {
  await browser?.close();
  server.stop(true);
  rmSync(workspace, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
