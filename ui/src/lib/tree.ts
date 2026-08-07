/**
 * Whose filesystem is the answer about?
 *
 * Observed, on a live run: a goal asking for a file count reached with the
 * answer `13621` — correct for the substrate's own clone under
 * `/workspace/git/…`, and different from the same count in the operator's
 * working copy. Both numbers are right about their own tree.
 *
 * A reader who checks that answer against their checkout sees a mismatch that
 * is NOT an error, and with nothing on screen to explain it, the honest
 * conclusion available to them is that the system lied. So where an answer
 * describes a filesystem, the surface says which filesystem.
 *
 * It does NOT fabricate a path. If the run carried one, it is shown; if it did
 * not, the note says only that the substrate reads its own tree — which is
 * true regardless.
 */

const FILESYSTEM_QUESTION =
  /\b(file|files|directory|directories|folder|repo|repository|tree|path|line count|lines of code|loc|checkout|worktree|clone|commit|branch)\b/i;

const COUNT_ANSWER = /^\s*[\d,]+\s*$/;

const PATH_LITERAL = /(\/[\w.@-]+){2,}/g;

export interface TreeAttribution {
  /** Paths the run itself named. Never invented — only echoed. */
  readonly paths: readonly string[];
}

export function describesFilesystem(goal: string | undefined, answerBody: string | null): boolean {
  if (goal && FILESYSTEM_QUESTION.test(goal)) return true;
  if (answerBody && COUNT_ANSWER.test(answerBody) && goal && /\b(how many|count|number of)\b/i.test(goal))
    return true;
  if (answerBody && PATH_LITERAL.test(answerBody)) return true;
  return false;
}

export function extractPaths(sources: readonly (string | null | undefined)[]): TreeAttribution {
  const found = new Set<string>();
  for (const source of sources) {
    if (!source) continue;
    const matches = source.match(PATH_LITERAL);
    if (!matches) continue;
    for (const match of matches) {
      found.add(match);
      if (found.size >= 4) break;
    }
  }
  return { paths: [...found] };
}
