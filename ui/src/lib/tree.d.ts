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
export interface TreeAttribution {
    /** Paths the run itself named. Never invented — only echoed. */
    readonly paths: readonly string[];
}
export declare function describesFilesystem(goal: string | undefined, answerBody: string | null): boolean;
export declare function extractPaths(sources: readonly (string | null | undefined)[]): TreeAttribution;
//# sourceMappingURL=tree.d.ts.map