// Optional real-browser check against a disposable, isolated Hono fixture.
// PLAYWRIGHT_MODULE may point to an existing playwright-core module; no live services are used.
import { mkdtempSync, rmSync } from "node:fs";
import assert from "node:assert/strict";
const workspace = mkdtempSync("/tmp/participation-browser-");
process.env.WORKSPACE_ROOT = workspace;
const root = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const { impulsesRouter } = await import(root + "/src/routes/impulses.ts");
const { participationRouter } = await import(root + "/src/routes/participation.ts");
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
async function author(body, title = "Check the incident evidence", id = "browser-question") {
  const response = await impulsesRouter.request("/v2/impulses/resolve", { method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({pointer:{type:"uiQuestion_write",id,title,body}})});
  assert.equal(response.status,200);
}
await author({claim:"Resource contention is confirmed",source:"The cause is still unverified", reference:{type:"incident",id:"42"}});
const server = Bun.serve({hostname:"127.0.0.1",port:0, async fetch(request) {
  const path = new URL(request.url).pathname;
  if (path === "/api/questions" || path === "/api/participation") return participationRouter.fetch(request);
  if (path === "/api/render-policy") return Response.json({tokenOverrides:{},formByShape:{},revision:0});
  if (path === "/api/discovery/shapes") return Response.json({shapes:[]});
  if (path === "/api/resolve") return Response.json({resolved:true,body:{dispatches:[]}});
  if (path.startsWith("/api/")) return Response.json({gaps:[]});
  const file = Bun.file(root + "/ui/dist" + (path === "/" ? "/index.html" : path));
  return new Response(file);
}});
let browser; let debugPage;
try {
  browser = await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE,args:["--no-sandbox"]});
  const page = await browser.newPage({viewport:{width:1280,height:1100}});
  debugPage=page;
  const errors=[]; page.on("pageerror", e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.port}`);
  const region=page.getByRole("region",{name:"Questions for you",exact:true});
  const active=region.locator(".sf-participation-detail > div:not([hidden])");
  await region.getByRole("heading",{name:"Check the incident evidence"}).waitFor();
  await region.getByText("Send structured content",{exact:true}).click();
  await active.getByLabel("Contribution format").selectOption("json");
  // New arrivals stay buffered; selecting another question must preserve this draft.
  await active.getByLabel("Your contribution",{exact:true}).fill("draft to retain");
  await author("Which source should be used?", "Choose a source", "another-question");
  assert.equal(await region.getByRole("button",{name:/Choose a source/}).count(),0);
  await region.getByRole("button",{name:/Refresh questions|Review updates/}).click();
  assert.equal(await active.getByLabel("Your contribution",{exact:true}).inputValue(),"draft to retain");
  await region.getByRole("button",{name:/Choose a source/}).click();
  await active.getByLabel("Your contribution",{exact:true}).fill("a different draft");
  await region.getByRole("button",{name:/Check the incident evidence/}).click();
  assert.equal(await active.getByLabel("Your contribution",{exact:true}).inputValue(),"draft to retain");
  await active.getByLabel("Your contribution",{exact:true}).fill('{"distinction":"suspected, not established","reference":{"type":"evidence","id":"42"}}');
  await region.getByRole("button",{name:"Send contribution",exact:true}).click();
  await region.getByText("Your contribution is recorded.",{exact:true}).waitFor();
  await region.getByRole("button",{name:"Refresh questions",exact:true}).waitFor();
  let read=await participationRouter.request("/api/questions");
  let q=(await read.json()).body.questions.find(question=>question.id==="browser-question");
  assert.equal(q.answers[0].value.distinction,"suspected, not established");
  assert.equal(q.responses.length,1);
  await region.getByRole("button",{name:"Send contribution",exact:true}).click();
  await page.waitForTimeout(100);
  read=await participationRouter.request("/api/questions");
  assert.equal((await read.json()).body.questions.find(question=>question.id==="browser-question").responses.length,1);
  await author({claim:"Revised question",source:"New evidence"});
  await active.getByLabel("Your contribution",{exact:true}).fill("false");
  await region.getByRole("button",{name:"Send contribution",exact:true}).click();
  await region.getByText(/The question changed or is unavailable/).waitFor();
  assert.equal(await active.getByLabel("Your contribution",{exact:true}).inputValue(),"false");
  await region.getByRole("button",{name:/Refresh questions|Review updates/}).click();
  await region.getByRole("button",{name:"Review revised question",exact:true}).click();
  assert.equal(await active.getByLabel("Your contribution",{exact:true}).inputValue(),"false");
  await region.getByRole("button",{name:"Send contribution",exact:true}).click();
  await region.getByText("Your contribution is recorded.",{exact:true}).waitFor();
  read=await participationRouter.request("/api/questions"); q=(await read.json()).body.questions.find(question=>question.id==="browser-question");
  assert.equal(q.answers[0].value,false);
  assert.equal(q.answers[0].panelRevision,2);
  await page.screenshot({path:"/tmp/substrate-participation-desktop.png",fullPage:true});
  await page.reload();
  await region.getByRole("button",{name:/Check the incident evidence/}).click();
  await region.getByRole("heading",{name:"Check the incident evidence"}).waitFor();
  await region.getByText("An answer is recorded.",{exact:false}).waitFor();
  await page.setViewportSize({width:390,height:844});
  await region.scrollIntoViewIfNeeded();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth),true);
  await page.screenshot({path:"/tmp/substrate-participation-mobile.png",fullPage:true});
  await page.emulateMedia({colorScheme:"dark"});
  await page.screenshot({path:"/tmp/substrate-participation-dark.png",fullPage:true});
  await active.getByLabel("Your contribution",{exact:true}).focus();
  await page.keyboard.type("keyboard contribution");
  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(()=>document.activeElement?.tagName),"SUMMARY");
  assert.deepEqual(errors,[]);
  console.log("PASS browser: structured answer, duplicate retry, stale revision rejection, preserved draft, revised answer, reload, buffered arrivals, retained drafts across selection, keyboard, narrow viewport, dark theme, no JS errors");
} catch (error) {
  if(debugPage) { console.log(await debugPage.locator("body").innerText()); await debugPage.screenshot({path:"/tmp/participation-failure.png",fullPage:true}); }
  throw error;
} finally {
  if(browser) await browser.close();
  server.stop(true); rmSync(workspace,{recursive:true,force:true});
}
