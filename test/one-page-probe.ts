// One-page probe: at wide viewports the whole surface must fit the viewport —
// the page never scrolls, only regions do — with all five information regions
// visible at once. Runs against a disposable fixture like browser-participation.ts.
import { mkdtempSync, rmSync } from "node:fs";
import assert from "node:assert/strict";
const workspace = mkdtempSync("/tmp/participation-onepage-");
process.env.WORKSPACE_ROOT = workspace;
const root = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const { impulsesRouter } = await import(root + "/src/routes/impulses.ts");
const { participationRouter } = await import(root + "/src/routes/participation.ts");
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");

// `asks` is a TOP-LEVEL pointer field whose items carry `prompt` — the vessel's
// interaction contract (src/routes/impulses.ts asks()). `body` is opaque human
// content the vessel never reinterprets as UI controls, so asks nested in the
// body produce zero parts and no part selector renders.
async function author(id: string, title: string, body: unknown, asks: unknown[]) {
  const response = await impulsesRouter.request("/v2/impulses/resolve", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ pointer: { type: "uiQuestion_write", id, title, body, asks } }),
  });
  assert.equal(response.status, 200);
  const panel = (await response.json() as any).body;
  assert.deepEqual(panel.asks?.map((a: any) => a.id), (asks as any[]).map(a => a.id),
    `${id}: the vessel did not accept the declared asks — the part selector would be absent`);
}

// Realistic load: three concurrent questions (S7 shape), one carrying long material
// so internal scrolling is actually exercised, not vacuously true.
await author("frozen-s7-a", "Name a retention policy for interaction journals", {},
  [{ id: "a1", prompt: "Propose a retention bound for interactor-log journals (currently unbounded)." }]);
await author("frozen-s7-b", "Choose a probe cadence", {},
  [{ id: "b1", prompt: "How often should the standing trend battery fire?" }]);
await author("frozen-s7-c", "Keep or retire the churn composition", {
  context: "learned-composition-uifeedback-write-to-shellresult: 368 fail / 36 success since July; " +
    "still firing every 30-60 minutes. ".repeat(12),
}, [{ id: "c1", prompt: "Retire, repair, or observe longer?" }]);

const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
  const path = new URL(request.url).pathname;
  if (path === "/api/questions" || path === "/api/participation") return participationRouter.fetch(request);
  if (path === "/api/render-policy") return Response.json({ tokenOverrides: {}, formByShape: {}, revision: 0 });
  if (path === "/api/discovery/shapes") return Response.json({ shapes: [] });
  if (path === "/api/resolve") return Response.json({ resolved: true, body: { dispatches: [] } });
  if (path.startsWith("/api/")) return Response.json({ gaps: [] });
  const file = Bun.file(root + "/ui/dist" + (path === "/" ? "/index.html" : path));
  // A missing asset (the browser's /favicon.ico) gets a 404, not an unhandled
  // ENOENT rejection: that rejection set a non-zero exit status after this probe
  // had already printed PASS. Absence only — other read errors still propagate.
  if (!(await file.exists())) return new Response("not found", { status: 404 });
  return new Response(file);
}});

let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_EXECUTABLE, args: ["--no-sandbox"] });
  for (const viewport of [{ width: 1440, height: 900 }, { width: 1280, height: 800 }]) {
    const page = await browser.newPage({ viewport });
    const errors: string[] = [];
    page.on("pageerror", e => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.port}`);
    const region = page.getByRole("region", { name: "Questions for you", exact: true });
    await region.getByRole("button", { name: /Keep or retire the churn composition/ }).click();
    await region.getByRole("heading", { name: "Keep or retire the churn composition" }).waitFor();

    // 1. The page itself must not scroll.
    const metrics = await page.evaluate(() => ({
      scrollH: document.scrollingElement!.scrollHeight,
      clientH: document.scrollingElement!.clientHeight,
      scrollW: document.scrollingElement!.scrollWidth,
      clientW: document.scrollingElement!.clientWidth,
    }));
    assert.ok(metrics.scrollH <= metrics.clientH + 1,
      `page scrolls vertically at ${viewport.width}x${viewport.height}: ${metrics.scrollH} > ${metrics.clientH}`);
    assert.ok(metrics.scrollW <= metrics.clientW + 1,
      `page scrolls horizontally at ${viewport.width}x${viewport.height}`);

    // 2. Every required region is on screen: heading visible within the viewport box.
    for (const name of ["Ask", "Questions for you", "Runs", "Detail", "Known wrong with this interface"]) {
      const heading = page.getByRole("heading", { name, exact: false }).first();
      await heading.waitFor();
      const box = await heading.boundingBox();
      assert.ok(box && box.y >= 0 && box.y + box.height <= viewport.height,
        `region heading "${name}" is not inside the ${viewport.width}x${viewport.height} viewport`);
    }

    // 3. Long material scrolls INSIDE the questions region, not the page.
    const detail = region.locator(".sf-participation-detail");
    const inner = await detail.evaluate(el => ({ scrollH: el.scrollHeight, clientH: el.clientHeight }));
    assert.ok(inner.scrollH > inner.clientH,
      "long question material did not overflow its own region — the internal-scroll assertion is vacuous");

    // 4. Zoom: browser zoom shrinks the CSS viewport, so 125% zoom on this
    // window is exactly a (w/1.25 x h/1.25) viewport. The layout must still
    // not scroll the page there.
    await page.setViewportSize({ width: Math.round(viewport.width / 1.25), height: Math.round(viewport.height / 1.25) });
    const zoomed = await page.evaluate(() => ({
      scrollH: document.scrollingElement!.scrollHeight, clientH: document.scrollingElement!.clientHeight }));
    assert.ok(zoomed.scrollH <= zoomed.clientH + 1, `page scrolls at 125% zoom equivalent (${viewport.width}w)`);
    await page.setViewportSize(viewport);

    assert.deepEqual(errors, []);
    if (viewport.width === 1440) {
      await page.screenshot({ path: "/tmp/substrate-onepage-1440.png" });
      await page.emulateMedia({ colorScheme: "dark" });
      await page.screenshot({ path: "/tmp/substrate-onepage-1440-dark.png" });
    }
    await page.close();
  }
  console.log("PASS one-page: no page scroll at 1440x900 and 1280x800 (and 125% zoom), all five regions in view, long material scrolls internally, no JS errors");
} finally {
  await browser?.close();
  server.stop(true);
  rmSync(workspace, { recursive: true, force: true });
}
