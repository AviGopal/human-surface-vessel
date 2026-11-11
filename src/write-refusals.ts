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

/**
 * Writes the question doors refused because a naming field (a panel's id, kind, title or
 * importance; human_input's solicitation_id or dispatch_id) was still a template placeholder, "{{goal.id}}": a writer whose bindings never resolved. Counted per shape
 * since this process started, beside the empty refusals, so such a writer is visible without logs.
 */
type TemplateDoor = "uiPanel_write" | "uiQuestion_write" | "human_input";
const templateCounts: Record<TemplateDoor, number> = { uiPanel_write: 0, uiQuestion_write: 0, human_input: 0 };

export function countTemplateRefusal(shape: TemplateDoor): void {
  templateCounts[shape] += 1;
}

export function templateRefusals(): { uiPanel_write: number; uiQuestion_write: number; human_input: number; since: number } {
  return { ...templateCounts, since };
}
