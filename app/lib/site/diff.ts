import { diffWords, structuredPatch } from "diff";

/**
 * The word-level diff and the stored, page-positioned hunks — engine 4, P3.
 *
 * Two texts go in, both of them already extracted and normalised (that is P1's
 * output, never raw HTML). Two outputs come out: the word-level change stream
 * that becomes copy, and the structured hunk list that gets stored in R2 and
 * handed to D3s/D3 as `item` (docs/engines/site-change.md).
 *
 * WHAT THIS FILE DELIBERATELY DOES NOT DO, each with the reason:
 *
 * - No pixel diff. pixelmatch 7.2.0 was rejected with the measurement behind it
 *   (docs/engines/site-change.md): a pixel diff on a marketing page is dominated
 *   by carousels, lazy images and A/B variants. The screenshot pair is
 *   evidence, never the detector. There is no image import here at all.
 *
 * - No diffing before the hash gate. `buildPageDiff` refuses unless the two
 *   payload hashes are present and differ. The unchanged tick writes one
 *   snapshot row and stops, so a caller reaching this module with equal hashes
 *   is a caller bug and it fails loudly instead of quietly producing an empty
 *   mark that reads as "we looked and nothing changed".
 *
 * - No network, no R2, no fetch, no DOM. This is text maths over two strings,
 *   so it runs identically in the Worker, in the test runner and in CI, and it
 *   is the layer that makes the hash gate's claim testable.
 */

/**
 * One word-level change, with its position in the before text so a stored hunk
 * can say *where on the page* the change landed, not just what it was.
 *
 * `startWord`/`endWord` are word indices in the before text — the unit the page
 * position of a text blob is measured in, because a character offset over
 * normalised whitespace is meaningless across two differently-wrapped blows of
 * the same page.
 */
export interface WordChange {
  /** The word or run of words literally unchanged. */
  before: string;
  /** The word or run of words that replaced them. Empty for a removal. */
  after: string;
  /** Word index in the before text where the change starts. */
  startWord: number;
  /** Word index in the before text where it ends. */
  endWord: number;
  /** Character offset in the before text — where the words actually sit. */
  startChar: number;
}

/**
 * A stored hunk. This is the shape that lands in R2 and travels back to Jev as
 * context, so every field is bounded: `lines` is jsdiff's own output (capped by
 * the `context` option), never the page.
 */
export interface StoredHunk {
  /** Line in the before text where the hunk starts, 1-based. */
  oldStart: number;
  /** Number of before lines the hunk covers. */
  oldLines: number;
  /** Line in the after text where the hunk starts, 1-based. */
  newStart: number;
  /** Number of after lines the hunk covers. */
  newLines: number;
  /** The `-`/`+`/` ` lines, bounded by `context`. */
  lines: string[];
  /**
   * Word index in the before text of the first change in this hunk, i.e. the
   * page position. A word index is stable where a line number is not, because
   * extracted text is one normalised blob whose line breaks come from block
   * elements rather than from the copy's own structure.
   */
  startWord: number;
}

/** The whole diff object P3 stores and hands to the judgment layer. */
export interface PageDiff {
  /** Word-level changes, in order. Only the real ones — equal runs omitted. */
  changes: WordChange[];
  /** The structured hunks for R2, with page position on each. */
  hunks: StoredHunk[];
  /** How many words came out of the before text. */
  wordsBefore: number;
  /** How many words came out of the after text. */
  wordsAfter: number;
  /** `wordsAfter - wordsBefore`. Signed: a vanished section goes negative. */
  wordDelta: number;
}

/**
 * Word-splitting rule for positions. Kept in one place so `startWord` means the
 * same thing here, in the stored hunks, and in the tests. A "word" is a
 * non-whitespace run; the units of prose copy, the price tokens and the URLs.
 */
const splitWords = (text: string): string[] => text.split(/\s+/).filter(Boolean);

/**
 * The hash gate. Returns true only when both hashes are present, non-empty and
 * different. A page with no previous snapshot, or an empty hash, is *not* a
 * change — it is a first-seen page, and the sweep records it as such.
 *
 * A boolean rather than a thrown error because the caller is a Workflow step
 * that must keep going: "no change" is the common, cheap, expected case.
 */
export function hasChanged(prevHash: string, nextHash: string): boolean {
  if (typeof prevHash !== "string" || typeof nextHash !== "string") return false;
  if (prevHash.length === 0 || nextHash.length === 0) return false;
  return prevHash !== nextHash;
}

/**
 * Word-diff two texts into positioned changes.
 *
 * jsdiff's `diffWords` walks the token stream in both directions, which is the
 * only mode that gives word granularity for prose; `diffLines` would bury a
 * price change inside a whole re-wrapped line, and the character-level modes
 * (`fast-diff`, `diff-match-patch`) were rejected in docs/REBUILD-STACK.md §5.2
 * for exactly that.
 */
export function diffWordsPositioned(before: string, after: string): WordChange[] {
  const parts = diffWords(before, after);

  // Walk the parts in order, counting words as jsdiff consumes them, so every
  // change's `startWord` is the true index in the before text rather than a
  // number reconstructed after the fact.
  const changes: WordChange[] = [];
  let wordIndex = 0;
  let charIndex = 0;
  let pendingRemoved: string | null = null;
  let pendingStart = -1;
  let pendingStartChar = -1;

  const flush = (added: string) => {
    if (pendingRemoved === null) return;
    changes.push({
      before: pendingRemoved,
      after: added,
      startWord: pendingStart,
      endWord: wordIndex,
      startChar: pendingStartChar,
    });
    pendingRemoved = null;
    pendingStart = -1;
    pendingStartChar = -1;
  };

  for (const part of parts) {
    if (part.removed) {
      // A removal carries no added text yet. jsdiff emits removed and added as
      // separate consecutive parts for a replacement, so the removal is held
      // until the paired addition (or the end) arrives.
      flush("");
      pendingRemoved = part.value;
      pendingStart = wordIndex;
      pendingStartChar = charIndex;
      wordIndex += splitWords(part.value).length;
      charIndex += part.value.length;
      continue;
    }

    if (part.added) {
      const added = pendingRemoved === null ? "" : part.value;
      if (pendingRemoved === null) {
        // A pure insertion with nothing removed: the change is "nothing became
        // something", so `before` is empty and the position is where it lands.
        const starts = charIndex;
        changes.push({
          before: "",
          after: part.value,
          startWord: wordIndex,
          endWord: wordIndex,
          startChar: starts,
        });
        wordIndex += splitWords(part.value).length;
        charIndex += part.value.length;
        continue;
      }
      flush(added);
      wordIndex += splitWords(part.value).length;
      charIndex += part.value.length;
      continue;
    }

    flush("");
    wordIndex += splitWords(part.value).length;
    charIndex += part.value.length;
  }

  flush("");

  return changes;
}

/**
 * The stored hunks, with page position. `structuredPatch` produces the bounded
 * `-`/`+` line context the packet asks for; the word index is grafted on
 * because the line numbers alone do not survive a normalised text blob.
 */
export function buildStoredHunks(before: string, after: string, context = 2): StoredHunk[] {
  if (context < 0) {
    throw new RangeError("context must be zero or more lines of context, never negative");
  }

  const patch = structuredPatch("before", "after", before, after, "", "", {
    context,
  });

  // jsdiff appends "\\ No newline at end of file" markers whenever an input does
  // not end in a newline — true of every extracted text blob, which is one
  // normalised string. The marker is a file-format concern, not a fact about the
  // copy, and it would sit in every stored hunk as noise the judge reads. Drop
  // it; the hunk's own `-`/`+`/` ` lines carry all the meaning.
  const stripNoNewline = (lines: string[]): string[] =>
    lines.filter((line) => line !== "\\ No newline at end of file");

  // A word boundary table, built once, so each hunk's word index is a lookup
  // rather than a re-scan per hunk.
  const lineWordStarts: number[] = [];
  {
    const lines = before.split("\n");
    let running = 0;
    for (const line of lines) {
      lineWordStarts.push(running);
      running += splitWords(line).length;
    }
  }
  const totalBeforeWords = splitWords(before).length;

  return patch.hunks.map((hunk) => {
    // The first `-` line in the hunk is where the before text first changed;
    // `oldStart` is 1-based against the split above.
    let hunkLine = hunk.oldStart - 1;
    let found = -1;
    for (const line of hunk.lines) {
      if (line.startsWith("-")) {
        found = hunkLine;
        break;
      }
      hunkLine += 1;
    }
    const startWord =
      found >= 0 && found < lineWordStarts.length ? lineWordStarts[found] : totalBeforeWords;

    return {
      oldStart: hunk.oldStart,
      oldLines: hunk.oldLines,
      newStart: hunk.newStart,
      newLines: hunk.newLines,
      lines: stripNoNewline(hunk.lines),
      startWord,
    };
  });
}

/** Inputs to the hash-gated builder. */
export interface PageDiffInput {
  /** The previous snapshot's payload hash — the gate. */
  prevHash: string;
  /** This tick's payload hash — the gate. */
  nextHash: string;
  /** The previous extracted, normalised text. */
  beforeText: string;
  /** This tick's extracted, normalised text. */
  afterText: string;
  /** Lines of context around each change in the stored hunks. */
  context?: number;
}

/**
 * Build the full diff, but only once the hash gate has fired.
 *
 * Throws when the gate has not fired. That is deliberate and it is the packet's
 * "never diff before the hash gate has said something changed", made a hard
 * error: an unchanged tick must write one snapshot row and stop, and a caller
 * that somehow gets here with two identical texts has a bug that must surface
 * now rather than produce a mark that reads as "watched, nothing changed".
 */
export function buildPageDiff(input: PageDiffInput): PageDiff {
  const { prevHash, nextHash, beforeText, afterText, context = 2 } = input;

  if (!hasChanged(prevHash, nextHash)) {
    throw new Error(
      "hash gate has not fired: refusing to diff unchanged payloads " +
        "(a Workflow step that reaches this needs to write its snapshot row and stop)",
    );
  }

  const changes = diffWordsPositioned(beforeText, afterText);
  const hunks = buildStoredHunks(beforeText, afterText, context);
  const wordsBefore = splitWords(beforeText).length;
  const wordsAfter = splitWords(afterText).length;

  return { changes, hunks, wordsBefore, wordsAfter, wordDelta: wordsAfter - wordsBefore };
}
