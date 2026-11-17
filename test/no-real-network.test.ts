/**
 * A test run reaches no network but its own servers: a fetch that falls through a test's fake to a
 * URL this run did not stand up throws, naming it, instead of reaching a host's live vessels.
 *
 * Shapes: a full run on a host serving a substrate grew past 30 GB while the same run, with no
 * network, finished; a fake that falls through can reach the live localhost ports on such a host.
 */
import { describe, expect, test } from "bun:test";
import { restoreNativeGlobals } from "./setup.ts";

describe("no real network", () => {
  test("must-fail: a URL this run did not stand up throws and is never fetched", async () => {
    await restoreNativeGlobals();
    for (const url of ["http://127.0.0.1:18310/api/session", "http://localhost:18100/resolve", "https://example.com/"]) {
      await expect(fetch(url)).rejects.toThrow(`test fetch refused: ${url}`);
    }
  });

  test("control: a server this run stood up is reached", async () => {
    await restoreNativeGlobals();
    const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("here") });
    try {
      expect(await (await fetch(`http://127.0.0.1:${server.port}/`)).text()).toBe("here");
    } finally {
      server.stop(true);
    }
  });
});
