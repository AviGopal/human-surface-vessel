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
