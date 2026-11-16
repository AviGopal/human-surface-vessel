/**
 * The surface's marks: a closed set of small line glyphs drawn in the current text colour. A
 * control that carries one names itself to a screen reader with aria-label; the glyph itself is
 * hidden from it, so state and action are never carried by the drawing alone.
 */

import type { ReactNode } from "react";

const PATHS = {
  right: "M4 10.5l4 4 8-9",
  wrong: "M5.5 5.5l9 9M14.5 5.5l-9 9",
  send: "M10 16V4M5 9l5-5 5 5",
  about: "M5 4v6a3 3 0 0 0 3 3h7M12 10l3 3-3 3",
  person: "M10 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM4.5 16.5c.8-2.6 3-4 5.5-4s4.7 1.4 5.5 4",
} as const;

export type GlyphName = keyof typeof PATHS;

export function Glyph({ name }: { name: GlyphName }): ReactNode {
  return (
    <svg className="sf-glyph" data-glyph={name} viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" focusable="false">
      <path d={PATHS[name]} fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
