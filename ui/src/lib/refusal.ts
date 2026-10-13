/**
 * A grade refusal this surface can recognise, in plain words, or null.
 *
 * Only the one refusal the server names exactly is paraphrased: activity-api
 * records a human verdict only from a credential issued with the
 * "verdict:human" scope, and this surface writes with its own service key.
 * Any other error is shown as the server sent it.
 */
export function gradeRefusal(message: string | null | undefined): string | null {
  return message && message.includes("verdict:human")
    ? "Not recorded: this surface's credential can't record a human verdict"
    : null;
}
