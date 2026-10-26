/**
 * Writes the panel door refused because they carried nothing: a new panel or question
 * with no title, body or asks. Counted per shape since this process started, and read
 * by `human_surface:ui_view`, so a writer that keeps sending empty writes is visible
 * without reading logs. Nothing is stored for a refused write.
 */
const counts: Record<"uiPanel_write" | "uiQuestion_write", number> = { uiPanel_write: 0, uiQuestion_write: 0 };
const since = Date.now();

export function countEmptyRefusal(shape: "uiPanel_write" | "uiQuestion_write"): void {
  counts[shape] += 1;
}

export function emptyRefusals(): { uiPanel_write: number; uiQuestion_write: number; since: number } {
  return { ...counts, since };
}
