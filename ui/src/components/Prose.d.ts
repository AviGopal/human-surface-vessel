/**
 * A markdown-lite renderer that builds React elements directly.
 *
 * No markdown library, for two reasons. One is rule P12 — every dependency is
 * bundle surface, and a markdown renderer is a large one. The other is that
 * building elements rather than HTML strings means there is no
 * `dangerouslySetInnerHTML` anywhere in this surface, so untrusted impulse
 * content cannot inject markup no matter what a walk put in the pool.
 *
 * Link targets are rendered as visible text rather than as anchors. Impulse
 * content is not trusted input, and a clickable link to a host a walk invented
 * is exactly the "never invent a vessel address" failure wearing a different
 * hat.
 */
import { type ReactNode } from "react";
export declare function Prose({ source }: {
    source: string;
}): ReactNode;
//# sourceMappingURL=Prose.d.ts.map