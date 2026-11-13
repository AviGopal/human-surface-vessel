/**
 * The public address a deployment states is shown on /health, with the reason a stated value is
 * refused, so a wrong value is read by effect (from the running surface), not from its unit.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { app } from "../src/index.ts";

const health = async () => (await (await app.request("http://127.0.0.1/health")).json()) as Record<string, unknown>;

describe("/health shows the stated public address", () => {
  afterEach(() => { delete process.env.HUMAN_SURFACE_PUBLIC_URL; });

  test("must-fail: a used address is shown; a refused one shows null and why; none stated shows null", async () => {
    process.env.HUMAN_SURFACE_PUBLIC_URL = "https://surface.example";
    expect(await health()).toMatchObject({ public_origin: "https://surface.example" });
    expect((await health()).public_origin_refused).toBeUndefined();

    process.env.HUMAN_SURFACE_PUBLIC_URL = "http://surface.example";
    expect(await health()).toMatchObject({ public_origin: null, public_origin_refused: "not https" });

    delete process.env.HUMAN_SURFACE_PUBLIC_URL;
    const none = await health();
    expect(none.public_origin).toBeNull();
    expect("public_origin_refused" in none).toBe(false);
  });
});
