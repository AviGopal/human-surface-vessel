/**
 * THE FORM DECISION, PROVEN IN A REAL BROWSER — and with it the two things a
 * synthetic POST cannot establish.
 *
 * Three claims, each with its control:
 *
 *   (a) A real render emits a `form_decision` record carrying all four joinable
 *       fields. Asserting this against a hand-built POST would only prove the
 *       route parses what I typed; the claim is that the RENDER PATH produces
 *       it, so the record has to come out of a committed paint in Chromium.
 *
 *   (b) A `renderPolicy` pin reaches the QUESTION CARD, and the record says
 *       `decided_by: "pin"`. This region called `planContent` with no policy at
 *       all until this change, so a pin worked in the evidence ledger and
 *       silently did nothing on the card a person was reading. The control is
 *       the same content with the pin absent: it must decide by some other
 *       branch, or the "pin" result proves nothing.
 *
 *   (c) The withholding line renders when — and only when — something is
 *       actually withheld. The negative arm is the load-bearing one: a
 *       disclosure that always renders is noise, and a reader trained to skip
 *       it will skip the one that matters.
 *
 * STUBBED, and named: `/api/observations` is served by this probe so the
 * pointer the browser sends can be captured verbatim, and the `ranking` block
 * is injected for claim (c) because a two-panel fixture legitimately withholds
 * nothing. Both stubs sit on the SERVER side of a contract the real routers
 * also serve, and the real route's own acceptance is covered separately in
 * test/form-decision.test.ts.
 *
 * EXIT CODES: 0 all claims held · non-zero a claim failed or could not be observed.
 *
 * RUN (redirection, never a pipe — a pipe reports the last stage's status):
 *   PLAYWRIGHT_MODULE=/home/avi/.bun/install/cache/playwright-core/1.62.1@@@1 \
 *   CHROMIUM_EXECUTABLE=/home/avi/.cache/ms-playwright/chromium-1224/chrome-linux64/chrome \
 *   bun repos/human-surface-vessel/test/form-decision-probe.ts > /tmp/fd.txt 2>&1; echo "RC=$?"
 */
import { mkdtempSync, rmSync } from "node:fs";
import assert from "node:assert/strict";

const workspace = mkdtempSync("/tmp/form-decision-probe-");
process.env.WORKSPACE_ROOT = workspace;
const root = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const { impulsesRouter } = await import(root + "/src/routes/impulses.ts");
const { participationRouter } = await import(root + "/src/routes/participation.ts");
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");

type Record_ = Record<string, unknown>;
type Decision = {
  shape: string;
  content_signature: string;
  form: string;
  decided_by: string;
  policy_revision: number | null;
  region: string;
};

/** The bare value that used to be drawn as a code listing. */
const BARE_VALUE = "82920";

async function author(id: string, title: string, body: unknown): Promise<void> {
  const response = await impulsesRouter.request("/v2/impulses/resolve", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      pointer: {
        type: "uiQuestion_write",
        id,
        title,
        kind: "gap_needs_human",
        body,
        asks: [{ id: id + "-a1", prompt: "Is this the right answer?" }],
      },
    }),
  });
  assert.equal(response.status, 200, `authoring ${id} returned ${response.status}`);
}

await author("fd-bare", "The product the walk computed", BARE_VALUE);

const records: Record_[] = [];
/** Claim (b): flipped on for the second page load. */
let pinQuestionsToProse = false;
/** Claim (c): flipped on for the third page load. */
let withhold = false;

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/api/observations") {
      records.push((await request.json()) as Record_);
      return Response.json({ ok: true });
    }
    if (path === "/api/questions") {
      const response = await participationRouter.fetch(request);
      if (!withhold) return response;
      // STUB for claim (c) only. A two-panel fixture withholds nothing, so the
      // honest summary would correctly report not_shown_count 0 and the line
      // would correctly not render — which is the control, not the claim.
      const payload = (await response.json()) as { body: Record_ };
      payload.body["ranking"] = {
        solicitations_total: 250,
        shown_count: 1,
        not_shown_count: 249,
        slice_size: 1,
        slice_source: "probe_stub",
        policy_revision: 9,
      };
      return Response.json(payload);
    }
    if (path === "/api/participation") return participationRouter.fetch(request);
    if (path === "/api/render-policy") {
      return Response.json({
        tokenOverrides: {},
        // The pin, keyed on the SAME shape name the card plans under.
        formByShape: pinQuestionsToProse ? { human_question: "prose" } : {},
        presentation: "onepage",
        revision: 9,
        updatedAt: Date.now(),
        note: "probe",
      });
    }
    if (path === "/api/feedback") return Response.json({ ok: true });
    if (path === "/api/discovery/shapes") return Response.json({ shapes: [] });
    if (path === "/api/resolve") return Response.json({ resolved: true, body: { dispatches: [] } });
    if (path.startsWith("/api/")) return Response.json({ gaps: [] });
    const file = Bun.file(root + "/ui/dist" + (path === "/" ? "/index.html" : path));
    if (!(await file.exists())) return new Response("not found", { status: 404 });
    return new Response(file);
  },
});

function decisions(): Decision[] {
  return records
    .filter((r) => r["obs_type"] === "form_decision")
    .flatMap((r) => (r["decisions"] as Decision[] | undefined) ?? []);
}

/** Poll the CAPTURED RECORDS. A timeout is a failure, never a skip. */
async function until(label: string, predicate: () => boolean, timeoutMs = 10_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(
    `timed out after ${timeoutMs}ms waiting for ${label}; decisions seen: ${JSON.stringify(decisions())}`,
  );
}

let browser;
let failed = false;
try {
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_EXECUTABLE,
    args: ["--no-sandbox"],
  });
  const errors: string[] = [];

  async function load(): Promise<import("playwright").Page> {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.port}`);
    await page.getByRole("region", { name: "Questions for you", exact: true }).waitFor();
    await page.waitForFunction(() => document.documentElement.dataset["presentation"] !== undefined);
    return page;
  }

  /* ── (a) the render path emits a joinable decision ──────────────────────── */
  const first = await load();
  await first.getByRole("button", { name: /The product the walk computed/ }).waitFor();
  await until("a form_decision from the question card", () =>
    decisions().some((d) => d.region === "question_card"),
  );
  const card = decisions().find((d) => d.region === "question_card")!;
  assert.equal(card.shape, "human_question", "the decision must name the shape a pin is keyed on");
  assert.match(card.content_signature, /^fnv1a32:[0-9a-f]{8}:\d+$/, "signature must be hash:length");
  assert.equal(card.policy_revision, 9, "the policy in force must ride with the decision");
  assert.equal(
    card.form,
    "scalar",
    `a bare value must be drawn as a value, not a listing (got ${card.form})`,
  );
  // CONTROL FOR (b): with no pin, this decision came from somewhere else.
  assert.notEqual(card.decided_by, "pin", "no pin was set, so nothing may claim one decided");
  assert.equal(card.decided_by, "rescue", `expected the rescue branch, got ${card.decided_by}`);
  console.log(
    `(a) HELD — question_card decided ${card.form} by ${card.decided_by} under policy revision ${String(card.policy_revision)}`,
  );
  await first.close();

  /* ── (b) a pin reaches the question card ────────────────────────────────── */
  pinQuestionsToProse = true;
  const second = await load();
  await second.getByRole("button", { name: /The product the walk computed/ }).waitFor();
  await until("a pinned form_decision", () =>
    decisions().some((d) => d.region === "question_card" && d.decided_by === "pin"),
  );
  const pinned = decisions().find((d) => d.decided_by === "pin")!;
  assert.equal(pinned.form, "prose", `the pin must decide the form (got ${pinned.form})`);
  assert.equal(pinned.region, "question_card", "the pin must reach the CARD, not only the ledger");
  console.log("(b) HELD — a renderPolicy pin reached the question card and is recorded as `pin`");
  await second.close();

  /* ── (c) the withholding line, both arms ────────────────────────────────── */
  const sliceLine = ".sf-participation-slice";
  const third = await load();
  await third.getByRole("button", { name: /The product the walk computed/ }).waitFor();
  assert.equal(
    await third.locator(sliceLine).count(),
    0,
    "NEGATIVE ARM: nothing was withheld, so no disclosure may be drawn",
  );
  await third.close();

  withhold = true;
  const fourth = await load();
  await fourth.locator(sliceLine).waitFor({ timeout: 10_000 });
  const text = (await fourth.locator(sliceLine).textContent()) ?? "";
  assert.match(text, /249 not shown/, `the disclosure must name how much is withheld (got "${text}")`);
  assert.match(text, /most important of\s+250/, `it must name the whole set (got "${text}")`);
  console.log(`(c) HELD — absent when nothing is withheld; reads "${text.trim()}" when 249 are`);
  await fourth.close();

  assert.deepEqual(errors, [], `page errors: ${errors.join(" | ")}`);
  console.log(
    `PASS form-decision: ${decisions().length} decision(s) recorded across ${
      records.filter((r) => r["obs_type"] === "form_decision").length
    } batch(es); pin reaches the card; withholding disclosed only when real`,
  );
} catch (error) {
  failed = true;
  console.error(`FAIL form-decision: ${(error as Error).message}`);
} finally {
  await browser?.close();
  server.stop(true);
  rmSync(workspace, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
