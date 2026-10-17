/** Draws a decoded view from the primitives, or reports why it can't (the caller falls back). */

import type { ReactNode } from "react";
import { bindText, type ViewNode } from "./view";

export function checkBindings(n: ViewNode, data: unknown): string | null {
  for (const [k, v] of Object.entries(n.props)) if (bindText(v, data) === null) return `${n.primitive}.${k}: ${typeof v === "string" ? v : v.path} does not resolve to text`;
  for (const c of n.children) {
    const e = checkBindings(c, data);
    if (e) return e;
  }
  return null;
}

export function Draw({ node, data }: { node: ViewNode; data: unknown }): ReactNode {
  const t = (k: string): string => {
    const v = node.props[k];
    return v === undefined ? "" : (bindText(v, data) ?? "");
  };
  const kids = node.children.map((c, i) => <Draw key={i} node={c} data={data} />);
  switch (node.primitive) {
    case "Stack":
      return <div className="sf-v-stack">{kids}</div>;
    case "Heading":
      return <h3 className="sf-view-label">{t("text")}</h3>;
    case "Text":
      return <p className="sf-v-text">{t("text")}</p>;
    case "Mark":
      return <span className="sf-person-mark">{t("text")}</span>;
    case "Fold":
      return (
        <details className="sf-how">
          <summary>{t("label")}</summary>
          {kids}
        </details>
      );
  }
}
