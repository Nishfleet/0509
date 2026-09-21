/**
 * Text diff over two extracted page records. `diff` (jsdiff) is the stack-named
 * library (docs/REBUILD-STACK.md §8); a hand-written differ is a forbidden
 * custom crawler piece under the packet's own rule.
 */
import { diffLines } from "diff";

export interface SiteTextDiff {
  added: number;
  removed: number;
  unchanged: number;
  excerpt: string;
}

const EXCERPT_LIMIT = 4000;

export function diffSiteText(before: string, after: string): SiteTextDiff {
  const parts = diffLines(before, after);
  let added = 0;
  let removed = 0;
  let unchanged = 0;
  const excerpt: string[] = [];
  let excerptLen = 0;
  for (const part of parts) {
    const count =
      part.count ?? part.value.split("\n").filter((l) => l.length > 0).length;
    if (part.added) {
      added += count;
      for (const line of part.value.split("\n").filter((l) => l.trim())) {
        if (excerptLen + line.length + 3 > EXCERPT_LIMIT) break;
        excerpt.push(`+ ${line}`);
        excerptLen += line.length + 3;
      }
    } else if (part.removed) {
      removed += count;
      for (const line of part.value.split("\n").filter((l) => l.trim())) {
        if (excerptLen + line.length + 3 > EXCERPT_LIMIT) break;
        excerpt.push(`- ${line}`);
        excerptLen += line.length + 3;
      }
    } else {
      unchanged += count;
    }
  }
  return { added, removed, unchanged, excerpt: excerpt.join("\n") };
}
