/**
 * Bullets as a model writes them: indented under a heading and nested. Before
 * this, an indented "- **Operating System**: Linux" ran into the paragraph as
 * ". - Architecture: … . - Kernel: …" (9c7ee149, 10-13).
 */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register({ url: "http://surface.test/" });

import { afterAll, describe, expect, test } from "bun:test";

const uiSrc = new URL("../ui/src/", import.meta.url).pathname;
const from = (spec: string): string => Bun.resolveSync(spec, uiSrc);
const React = await import(from("react"));
const { createRoot } = await import(from("react-dom/client"));
const { act } = React;
const { Prose } = await import("../ui/src/components/Prose");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function mount(source: string): Promise<HTMLElement> {
  const el = document.createElement("div");
  document.body.appendChild(el);
  await act(async () => {
    createRoot(el).render(React.createElement(Prose, { source }));
  });
  return el;
}

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

const MODEL = [
  "Here's a summary based on the current system state:",
  "",
  "### 1. **System/Container Environment**",
  "   - **Operating System**: Linux",
  "   - **Architecture**: `x86_64`.",
  "",
  "### 2. **Available Files and Resources**",
  "   The `/vessels/development-vessel/` directory contains the following:",
  "   - **Key Files**:",
  "     - `CLAUDE.md`: Likely a project documentation file.",
  "     - `bun.lock`: Lock file.",
  "   - **Directories**:",
  "     - `src`: Source code directory.",
].join("\n");

describe("Prose bullets", () => {
  test("must-fail: indented bullets are list items, not text run into a paragraph", async () => {
    const el = await mount(MODEL);
    const items = [...el.querySelectorAll("li")].map((li) => [li.textContent, li.getAttribute("data-depth")]);
    expect(items).toEqual([
      ["Operating System: Linux", "0"],
      ["Architecture: x86_64.", "0"],
      ["Key Files:", "0"],
      ["CLAUDE.md: Likely a project documentation file.", "1"],
      ["bun.lock: Lock file.", "1"],
      ["Directories:", "0"],
      ["src: Source code directory.", "1"],
    ]);
    expect(el.textContent).not.toContain(". - ");
  });

  test("an unindented list is unchanged", async () => {
    const el = await mount("- one\n- two");
    expect([...el.querySelectorAll("li")].map((li) => li.getAttribute("data-depth"))).toEqual(["0", "0"]);
  });
});
