/**
 * human-surface-vessel — the substrate's human surface.
 *
 * Replaces stateful-ui-vessel and INHERITS its shape vocabulary: retiring a
 * vessel must not retire the vocabulary it served.
 *
 * Port 8310 (its own — 8290 belongs to the obsidian-vessel resolver bridge).
 *
 * Responsibilities:
 *   - serve the seven inherited shapes at /v2/impulses/resolve
 *   - proxy the browser to goal-host and discovery, injecting auth server-side
 *     (see routes/proxy.ts — that file is a security boundary)
 *   - serve the built UI from ../ui/dist
 *   - register flat with discovery, re-registering as its own heartbeat
 */
import { Hono } from "hono";
declare const app: Hono<import("hono/types").BlankEnv, import("hono/types").BlankSchema, "/">;
export { app };
//# sourceMappingURL=index.d.ts.map