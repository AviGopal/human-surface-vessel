/** "your answer" on an output produced by the step a person's answer drove; nothing otherwise. */

import type { ReactNode } from "react";

export function PersonMark({ fromPerson }: { fromPerson: boolean }): ReactNode {
  if (!fromPerson) return null;
  return (
    <span className="sf-person-mark" data-provenance="from-a-person" title="Produced by the step your answer to this run's question drove.">
      your answer
    </span>
  );
}
