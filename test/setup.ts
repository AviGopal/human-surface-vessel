import { mkdtempSync, rmSync } from "node:fs";
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
