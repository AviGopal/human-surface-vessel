/**
 * The exposure record's falsifier, in a real browser against a disposable
 * workspace. Nothing here touches the live substrate.
 *
 * Three claims, and the first is what makes the record mean anything:
 *   (a) a solicitation row scrolled below the fold of the on-screen list is NOT
 *       in the visible slice, while a row inside the viewport box IS. Without
 *       that pair, "visible" would just mean "in the DOM" and the learner would
 *       be conditioned on presence rather than presentation.
 *   (b) answering a solicitation produces the `answered` outcome and no
 *       `shown_not_acted` for it.
 *   (c) a solicitation presented twice with no act accumulates
 *       `shown_not_acted` (exposure_count 2), not two answers.
 *
 * STUBBED, and stated here as well as in the report: `POST /api/observations`
 * is served BY THIS PROBE, because the server side of that contract belongs to
 * the agent who owns src/routes/*.ts this phase. The probe captures exactly the
 * pointer the browser sends; the shape name, obs_type values and pointer fields
 * are the contract. `POST /api/feedback` is likewise stubbed 200 so the
 * complaint path's success state can be reached without the gap store.
 */
import { mkdtempSync, rmSync } from "node:fs";
import assert from "node:assert/strict";

const workspace = mkdtempSync("/tmp/exposure-probe-");
process.env.WORKSPACE_ROOT = workspace;
const root = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const { impulsesRouter } = await import(root + "/src/routes/impulses.ts");
const { participationRouter } = await import(root + "/src/routes/participation.ts");
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");

const VIEWPORT = { width: 1440, height: 900 };
// Enough rows that the list must scroll: the below-fold row is the control that
// keeps claim (a) from being vacuous.
const COUNT = 24;

async function author(id: string, title: string): Promise<void> {
  const response = await impulsesRouter.request("/v2/impulses/resolve", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      pointer: {
        type: "uiQuestion_write",
        id,
        title,
        kind: "gap_needs_human",
        body: { context: "stale escalation fixture" },
        asks: [{ id: id + "-a1", prompt: "Retire, repair, or observe longer?" }],
      },
    }),
  });
  assert.equal(response.status, 200);
}

// Authored oldest-first; the surface orders newest-first, so `sol-23` is row 1.
for (let index = 0; index < COUNT; index += 1) {
  await author(`sol-${index}`, `Escalation ${index}: 9 failed repairs, nobody has decided`);
  await new Promise((resolve) => setTimeout(resolve, 2));
}

type Record_ = Record<string, unknown>;
const records: Record_[] = [];
/** Flipped on before the second tick, so both the pre-ranker and ranker-published paths are observed. */
let injectRanking = false;

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/api/observations") {
      records.push((await request.json()) as Record_);
      return Response.json({ ok: true });
    }
    if (path === "/api/feedback") return Response.json({ ok: true });
    if (path === "/api/questions") {
      const response = await participationRouter.fetch(request);
      if (!injectRanking) return response;
      // STUB for the ranker's half of the payload contract: the real producer is
      // src/importance.ts rankPanels/because, carried on the questions payload by
      // an agent who owns that route this phase. Injected here so the
      // ranker-published path (data-rank / data-rank-explanation → rank_source
      // "ranker") is exercised in a real browser rather than assumed.
      const body = (await response.json()) as { body: { questions: Record_[] } };
      body.body.questions = body.body.questions.map((question, index) => ({
        ...question,
        rank: index + 1,
        because: [`stale escalation: 9 failed repairs and nobody has decided (${String(question["id"])})`],
      }));
      return Response.json(body);
    }
    if (path === "/api/participation") return participationRouter.fetch(request);
    if (path === "/api/render-policy") {
      return Response.json({ tokenOverrides: {}, formByShape: {}, presentation: "onepage", revision: 1 });
    }
    if (path === "/api/discovery/shapes") return Response.json({ shapes: [] });
    if (path === "/api/resolve") return Response.json({ resolved: true, body: { dispatches: [] } });
    if (path.startsWith("/api/")) return Response.json({ gaps: [] });
    const file = Bun.file(root + "/ui/dist" + (path === "/" ? "/index.html" : path));
    if (!(await file.exists())) return new Response("not found", { status: 404 });
    return new Response(file);
  },
});

const exposures = (): Record_[] => records.filter((r) => r["obs_type"] === "exposure");
const outcomes = (): Record_[] => records.filter((r) => r["obs_type"] === "exposure_outcome");
const outcomesFor = (id: string, outcome: string): Record_[] =>
  outcomes().filter((r) => r["panel_id"] === id && r["outcome"] === outcome);
const sliceIds = (record: Record_): string[] =>
  (record["visible_in_viewport"] as { solicitation_id: string }[]).map((item) => item.solicitation_id);

/** Poll until a condition about the CAPTURED RECORDS holds; a timeout is a failure, never a skip. */
async function until(label: string, predicate: () => boolean, timeoutMs = 8000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timed out after ${timeoutMs}ms waiting for ${label} (records: ${JSON.stringify(records.map(r => [r["obs_type"], r["panel_id"], r["outcome"]]))})`);
}

let browser;
try {
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROMIUM_EXECUTABLE,
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage({ viewport: VIEWPORT });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.port}`);
  const region = page.getByRole("region", { name: "Questions for you", exact: true });
  await region.getByRole("button", { name: /Escalation 23/ }).waitFor();
  await page.waitForFunction(() => document.documentElement.dataset["presentation"] !== undefined);
  await page.waitForFunction(() => document.querySelectorAll("[data-solicitation-id]").length > 0);

  // ── (a) visible slice vs the DOM ─────────────────────────────────────────
  // Ground truth computed independently, straight from the browser's own boxes,
  // so the assertion is not just the reporter agreeing with itself.
  const truth = await page.evaluate((height: number) => {
    const list = document.querySelector(".sf-question-list")!;
    const listBox = list.getBoundingClientRect();
    const clipTop = Math.max(0, listBox.top + list.clientTop);
    const clipBottom = Math.min(height, listBox.top + list.clientTop + list.clientHeight);
    return Array.from(document.querySelectorAll<HTMLElement>("[data-solicitation-id]")).map((element) => {
      const box = element.getBoundingClientRect();
      const top = Math.max(box.top, clipTop);
      const bottom = Math.min(box.bottom, clipBottom);
      const fraction = box.height > 0 ? Math.max(0, bottom - top) / box.height : 0;
      return { id: element.getAttribute("data-solicitation-id")!, fraction };
    });
  }, VIEWPORT.height);

  const onScreen = truth.filter((row) => row.fraction >= 0.5).map((row) => row.id);
  const offScreen = truth.filter((row) => row.fraction === 0).map((row) => row.id);
  assert.ok(onScreen.length > 0, "no row was on screen — the fixture cannot test exposure");
  assert.ok(
    offScreen.length > 0,
    `every one of ${COUNT} rows fits the ${VIEWPORT.height}px viewport — claim (a) would be vacuous; ` +
      `increase COUNT or shrink the viewport`,
  );

  await until("the first exposure record", () => exposures().length >= 1);
  assert.equal(exposures().length, 1, `expected one exposure record for the first accepted snapshot, got ${exposures().length}`);
  const first = exposures()[0]!;
  assert.equal(Object.keys(first)[0], "origin", "machine-origin marker is not the first field");
  assert.equal(first["origin"], "machine");
  assert.equal(first["type"], "interactorObservation");
  assert.equal(first["scan_status"], "observed");
  assert.equal(first["snapshot_count"], COUNT);
  assert.equal(first["candidates_total"], COUNT);
  assert.deepEqual(first["viewport"], VIEWPORT);
  assert.equal(first["presentation_variant"], "onepage", "the adopted presentation variant was not recorded");
  assert.deepEqual(first["unobservable"], [], "a presentation condition was unreadable at the first tick");
  assert.match(
    String(first["renderer_bundle"]),
    /^index-.*\.js$/,
    `renderer bundle was not read off the executed script: ${String(first["renderer_bundle"])}`,
  );

  const reported = sliceIds(first);
  for (const id of offScreen) {
    assert.ok(
      !reported.includes(id),
      `row ${id} is cropped to nothing by the on-screen list yet was reported visible — ` +
        `the record would mean "present in the DOM"`,
    );
  }
  for (const id of onScreen) {
    assert.ok(reported.includes(id), `row ${id} is inside the viewport box yet was not reported visible`);
  }
  assert.equal(
    first["not_in_visible_slice_count"],
    COUNT - reported.length,
    "the withheld count does not match the slice — the record is not honest about what it did not show",
  );
  // REPAIRED, not weakened: this block asserted that the FIRST tick carried no
  // ranking explanation, because when it was written the real `/api/questions`
  // payload published none and the probe's `injectRanking` stub was the only
  // source of one. The ranked read has since landed, so the real route now
  // publishes `rank` and `because` on every snapshot and the pre-ranker path is
  // unreachable through it — the old assertion was testing a world that no
  // longer exists. The claim it protected ("an absent explanation is reported as
  // absent, never fabricated") is still executed, purely, at
  // test/exposure.test.ts:97-98, where a candidate with a null explanation can
  // actually be constructed. What is asserted here instead is the stronger
  // live-browser claim: an explanation that WAS published is carried, and is
  // never a fabrication of the reporter's.
  for (const item of first["visible_in_viewport"] as Record_[]) {
    assert.equal(
      item["ranking_explanation_observed"],
      true,
      "the ranked read published an explanation and the record did not observe it",
    );
    assert.equal(
      typeof item["ranking_explanation"],
      "string",
      "an observed explanation was reported as something other than the published text",
    );
    assert.ok(
      String(item["ranking_explanation"]).length > 0,
      "an observed explanation was reported as an empty string",
    );
    assert.equal(item["rank_source"], "ranker", "a ranker-published rank was reported as dom_order");
  }

  // ── (b) answering yields `answered`, never the ignored outcome ────────────
  const answeredId = reported[0]!;
  await region.getByRole("button", { name: new RegExp(`Escalation ${answeredId.split("-")[1]}:`) }).click();
  // Every card is rendered; only the selected one is unhidden. Scope to the
  // visible wrapper — the hidden siblings are the same zero-box elements the
  // visibility measurement refuses to count.
  const card = region.locator(".sf-participation-detail > div:not([hidden])");
  await card.getByLabel("Your contribution").fill("Retire it; the composition has failed 368 times.");
  await card.getByRole("button", { name: "Send contribution" }).click();
  await card.getByText("Your contribution is recorded.").waitFor();
  await until("the answered outcome record", () => outcomesFor(answeredId, "answered").length >= 1);

  assert.equal(
    outcomesFor(answeredId, "answered").length,
    1,
    `answering ${answeredId} did not produce exactly one answered outcome`,
  );
  const answered = outcomesFor(answeredId, "answered")[0]!;
  assert.equal(answered["origin"], "machine");
  assert.equal(answered["inferred"], false);
  assert.equal(answered["outcome_scope"], "panel");
  assert.equal(
    outcomesFor(answeredId, "shown_not_acted").length,
    0,
    "an answered solicitation was also recorded as shown-and-not-acted-on",
  );
  assert.equal(outcomesFor(answeredId, "declined").length, 0, "answering was recorded as a decline");

  // ── (c) shown twice with no act accumulates the ignored outcome ───────────
  const ignoredId = reported.find((id) => id !== answeredId)!;
  injectRanking = true;
  await region.getByRole("button", { name: "Refresh questions" }).click();
  await until("the second exposure record", () => exposures().length >= 2);
  assert.equal(exposures().length, 2, "the accepted refresh did not produce a second exposure record");
  assert.ok(sliceIds(exposures()[1]!).includes(ignoredId), `${ignoredId} was not visible on the second tick`);

  const ignored = outcomesFor(ignoredId, "shown_not_acted");
  assert.equal(ignored.length, 1, `${ignoredId} was shown twice without an act but produced ${ignored.length} ignored outcomes`);
  assert.equal(ignored[0]!["exposure_count"], 2, "the ignored outcome does not carry the accumulated exposure count");
  assert.equal(ignored[0]!["inferred"], true, "a machine-inferred outcome is not marked inferred");
  assert.equal(outcomesFor(ignoredId, "answered").length, 0, "a shown-and-ignored solicitation was recorded as answered");
  assert.equal(
    outcomesFor(answeredId, "shown_not_acted").length,
    0,
    "the answered solicitation gained an ignored outcome on re-presentation",
  );

  // ── the ranking explanation the rows were shown with ─────────────────────
  // Second tick only: the first snapshot carried no ranker fields, so the two
  // ticks together show the record reporting an absent explanation as absent
  // and a published one verbatim.
  const ranked = (exposures()[1]!["visible_in_viewport"] as Record_[]);
  assert.ok(ranked.length > 0, "the second tick reported an empty slice");
  for (const item of ranked) {
    assert.equal(item["rank_source"], "ranker", "a ranker-published rank was reported as dom_order");
    assert.equal(
      item["ranking_explanation"],
      `stale escalation: 9 failed repairs and nobody has decided (${String(item["solicitation_id"])})`,
      "the explanation the row was shown with was not carried verbatim",
    );
    assert.equal(item["ranking_explanation_observed"], true);
    assert.equal(typeof item["dom_position"], "number", "rendered position was not recorded alongside the rank");
    assert.equal(item["element_role"], "list_row");
  }

  // ── the fourth outcome: complained, kept apart from declined ─────────────
  // It fires only after the complaint is ACCEPTED, and it is a statement about
  // the interface rather than about the question — which is why it is not
  // folded into `declined`.
  const complainedId = reported.find((id) => id !== answeredId && id !== ignoredId)!;
  await region.getByRole("button", { name: new RegExp(`Escalation ${complainedId.split("-")[1]}:`) }).click();
  const complainCard = region.locator(".sf-participation-detail > div:not([hidden])");
  await complainCard.getByRole("button", { name: "something's wrong here" }).click();
  await complainCard.getByRole("textbox", { name: /what is wrong with/ }).fill("I cannot tell which of these 24 matters.");
  await complainCard.getByRole("button", { name: "file it" }).click();
  await until("the complained outcome record", () => outcomesFor(complainedId, "complained").length >= 1);
  assert.equal(outcomesFor(complainedId, "complained").length, 1);
  assert.equal(outcomesFor(complainedId, "declined").length, 0, "a complaint was recorded as a decline");
  assert.equal(outcomesFor(complainedId, "answered").length, 0, "a complaint was recorded as an answer");

  // Never-shown rows produce no record of any kind.
  for (const id of offScreen) {
    assert.equal(
      outcomes().filter((r) => r["panel_id"] === id).length,
      0,
      `${id} was never in a visible slice yet carries an outcome record — "never shown" was scored`,
    );
  }

  // The forbidden channel, checked in the traffic rather than in the source.
  assert.ok(
    records.every((record) => !JSON.stringify(record).includes("uiFeedback")),
    "a record sent from the reporter named uiFeedback",
  );
  assert.ok(
    !JSON.stringify(records).match(/"(seen|viewed|noticed|attended|impressions?)"/),
    "a field name claims attention, which this measurement cannot support",
  );

  assert.deepEqual(errors, []);
  await page.screenshot({ path: "/tmp/substrate-exposure-1440.png" });
  console.log(
    `PASS exposure: ${onScreen.length}/${COUNT} rows visible in the 1440x900 viewport box, ` +
      `${offScreen.length} cropped rows correctly absent; answered=1 declined=0 ignored(answered id)=0; ` +
      `second presentation accumulated shown_not_acted exposure_count=2; complained kept distinct from declined; ` +
      `${records.length} records, all machine-origin, none naming uiFeedback or claiming attention`,
  );
} finally {
  await browser?.close();
  server.stop(true);
  rmSync(workspace, { recursive: true, force: true });
}
