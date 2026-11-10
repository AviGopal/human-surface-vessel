/**
 * The runs list opens on the reader's own runs.
 */
import { describe, expect, test } from "bun:test";
import { initialFilter } from "../ui/src/components/RunsList";

describe("initialFilter", () => {
  test("defaults to the reader's own runs when nothing is remembered", () => {
    expect(initialFilter()).toBe("mine");
  });
});
