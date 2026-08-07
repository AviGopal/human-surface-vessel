import { useEffect, useState } from "react";

/**
 * A clock for elapsed-time cells.
 *
 * This ticks the CELL, not the list. Elapsed time is deliberately not a sort
 * key and not a layout input, so a row's clock advancing changes one string
 * inside a fixed grid cell and moves nothing. Tabular numerals in the CSS keep
 * the cell from changing width as the digits change.
 *
 * It obeys the pause control, because a reader who stopped the world to grade
 * something did not mean "except the clocks".
 */
export function useNow(paused: boolean, tickMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (paused) return;
    const id = window.setInterval(() => setNow(Date.now()), tickMs);
    return () => window.clearInterval(id);
  }, [paused, tickMs]);

  return now;
}
