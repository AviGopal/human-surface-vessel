import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const workspace = mkdtempSync(join(tmpdir(), "human-surface-test-"));
process.env.WORKSPACE_ROOT = workspace;
process.once("exit", () => rmSync(workspace, { recursive: true, force: true }));
