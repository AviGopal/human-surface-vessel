import { mkdtempSync, rmSync } from "node:fs";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { tmpdir } from "node:os";
import { join } from "node:path";

const workspace = mkdtempSync(join(tmpdir(), "human-surface-test-"));
process.env.WORKSPACE_ROOT = workspace;
process.once("exit", () => rmSync(workspace, { recursive: true, force: true }));

// THE TEST CALLER. Every write route needs a caller (src/inbound-auth.ts). A run gets its own
// throwaway node key, which src/caller-credential.ts authenticates locally as this vessel's
// own, so a test write sends `Authorization: ApiKey <it>` (testAuth below) and never the live
// fleet key: the live keys are dropped here. Identity points at an address nothing answers,
// so any other key fails closed unless a test stands up its own identity stub.
delete process.env.HUMAN_SURFACE_VESSEL_API_KEY;
process.env.METABOB_API_KEY = `test-node-key-${crypto.randomUUID()}`;
process.env.IDENTITY_VESSEL_URL = "http://127.0.0.1:9";

/** The header a test write carries: this run's own node key. */
export function testAuth(): { Authorization: string } {
  return { Authorization: `ApiKey ${process.env.METABOB_API_KEY}` };
}

// THE RUNTIME'S OWN GLOBALS, taken here because the preload runs before any test file. In ONE bun process
// (pull-sync's gate runs the whole suite that way) a file can leave the globals replaced: a UI file registers
// happy-dom at load and unregisters only in an afterAll, which never runs when a later top-level import of the
// file throws (the gate's tree has no ui/node_modules, so `react` does not resolve); and a file that stubs
// globalThis.fetch at load leaves its stub. happy-dom's Request drops the forbidden Origin header and its fetch
// is not the runtime's, so a later file that reads Origin or talks to a real local server measures the wrong
// thing. A file that does should call restoreNativeGlobals() first.
const NATIVE = { fetch: globalThis.fetch, Request: globalThis.Request, Response: globalThis.Response, Headers: globalThis.Headers };

/** Put back the runtime's fetch/Request/Response/Headers, unregistering a happy-dom an earlier file left behind. */
export async function restoreNativeGlobals(): Promise<void> {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
  Object.assign(globalThis, NATIVE);
}

// THE SURFACE'S OWN-RUN RECORD (src/own-dispatches.ts) is a file under the one WORKSPACE_ROOT above plus a module
// cache, so in ONE process the runs one file records are still there for the next. A file that records any (a keyless
// same-origin /api/run-goal, or a backfill from its stubbed goal-host) calls this in an afterAll; otherwise a later
// file that needs the record empty (own-dispatches-backfill) or exact (own-dispatches) reads the earlier file's rows.
/** Remove the own-run record file and forget its cache. */
export async function forgetOwnDispatches(): Promise<void> {
  rmSync(join(process.env.WORKSPACE_ROOT ?? workspace, "state", "human-surface", "own-dispatches.jsonl"), { force: true });
  rmSync(join(process.env.WORKSPACE_ROOT ?? workspace, "state", "human-surface", "own-outcomes.jsonl"), { force: true });
  (await import("../src/own-dispatches.ts")).resetOwnDispatchesForTest();
}

// A SIGNED-IN PERSON (src/person-session.ts). Asking from the page needs one, and "Mine" is that person's asks, so a
// test that asks or reads Mine opens a session and sends its cookie. Nothing reaches identity: the session is held
// in this process only, as a sign-in would hold it.
/** Open a person session; the Cookie header value that names it. */
export async function signedInCookie(userId = "user:person-a", name: string | null = "Person A"): Promise<string> {
  const { openSession } = await import("../src/person-session.ts");
  const { id } = openSession({ token: `test-token-${userId}`, userId, orgId: null, email: null, name, expiresAt: Date.now() + 900_000 });
  return `sf_person=${id}`;
}

// WHERE A SIGNED-IN PERSON'S LABEL GOES. A human verdict needs a signed-in person, and is then written as them: the
// registry names this node's label writer and identity mints an on-behalf-of token for it. A test that grades stubs
// both with this (null for any other call).
export const TEST_LABEL_WRITER = "http://writer.local:8080";
export const TEST_OBO = "eyJ.test-obo.sig";
export function labelWriterStub(input: RequestInfo | URL, init?: RequestInit): Response | null {
  const url = String(input);
  if (url.endsWith("/v1/auth/on-behalf-of")) return Response.json({ success: true, data: { token: TEST_OBO, expires_at: new Date(Date.now() + 60_000).toISOString() } });
  let body: { pointer?: { type?: unknown } } = {};
  try {
    body = JSON.parse(String(init?.body ?? "{}")) as typeof body;
  } catch {
    /* not json */
  }
  if (body.pointer?.type === "vesselRegistry") {
    return Response.json({ content: { vessels: [{ vesselId: "activity-api", shapes: ["goal_verification_label_write"], endpoint: TEST_LABEL_WRITER, protocol: "http", origin: "local", metadata: { node: "node-a" } }] } });
  }
  return null;
}

// THE SURFACE'S VIEWS (src/ui-views.ts) are a file under the same WORKSPACE_ROOT plus a module cache, so a file that
// writes a view calls this before and after, and the next file draws each region's default.
/** Remove the views file and forget its cache. */
export async function forgetViews(): Promise<void> {
  rmSync(join(process.env.WORKSPACE_ROOT ?? workspace, "state", "human-surface", "ui-views.jsonl"), { force: true });
  (await import("../src/ui-views.ts")).resetViewsForTest();
}

// REACT IS DRAINED BEFORE THE DOM GOES. A UI test renders React roots into happy-dom and unregisters happy-dom in its
// afterAll. React's scheduler runs its work loop as a macrotask (performWorkUntilDeadline), so a render that a late
// query or timer scheduled can run AFTER the unregister and read `window.event` with no window: an "Unhandled error
// between tests" that fails the file although its tests passed. teardownDom() unmounts every root the file created
// (trackRoot), lets React flush inside act(), waits for the scheduler's queue to empty (an idle-priority callback runs
// only after every queued task), and only then unregisters. Never catch, filter or delay the error instead.
const UI_SRC = new URL("../ui/src/", import.meta.url).pathname;
const liveRoots = new Set<{ unmount(): void }>();

/** Record a React root so teardownDom() unmounts it. Returns the root. */
export function trackRoot<R extends { unmount(): void }>(root: R): R {
  liveRoots.add(root);
  return root;
}

/** Unmount every tracked root, drain React's scheduler, then unregister happy-dom (when `unregister` is not false). */
export async function teardownDom(opts: { unregister?: boolean } = {}): Promise<void> {
  const React = (await import(Bun.resolveSync("react", UI_SRC))) as { act: (cb: () => Promise<void>) => Promise<void> };
  const Scheduler = (await import(Bun.resolveSync("scheduler", Bun.resolveSync("react-dom/client", UI_SRC)))) as {
    unstable_scheduleCallback: (priority: number, cb: () => void) => unknown;
    unstable_IdlePriority: number;
  };
  await React.act(async () => {
    for (const root of liveRoots) root.unmount();
  });
  liveRoots.clear();
  await new Promise<void>((resolve) => Scheduler.unstable_scheduleCallback(Scheduler.unstable_IdlePriority, () => resolve()));
  if (opts.unregister !== false && GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
}
