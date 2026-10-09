interface Frame {
  name: string;
  lastChild: string | null;
  lastChildEnd: number;
}

const TAG = /<(\/?)([^\s/<>!?]+)[^<>]*?(\/?)>/y;

const OPAQUE: readonly (readonly [string, string])[] = [
  ["<![CDATA[", "]]>"],
  ["<!--", "-->"],
  ["<?", "?>"],
];

function skipOpaque(xml: string, pos: number): number | null {
  const found = OPAQUE.find(([open]) => xml.startsWith(open, pos));
  if (found === undefined) return pos;
  const close = xml.indexOf(found[1], pos + found[0].length);
  return close === -1 ? null : close + found[1].length;
}

function record(stack: Frame[], match: RegExpExecArray): void {
  const [, closing, name, selfClosing] = match;
  const end = match.index + match[0].length;
  if (closing === "" && selfClosing === "") {
    stack.push({ name: name ?? "", lastChild: null, lastChildEnd: end });
    return;
  }
  if (closing === "/") stack.pop();
  const parent = stack.at(-1);
  if (parent) {
    parent.lastChild = name ?? "";
    parent.lastChildEnd = end;
  }
}

function walk(xml: string): Frame[] {
  const stack: Frame[] = [];
  let pos = xml.indexOf("<");
  while (pos !== -1) {
    const next = skipOpaque(xml, pos);
    if (next === null) break;
    TAG.lastIndex = next;
    const match = next === pos ? TAG.exec(xml) : null;
    if (match) record(stack, match);
    pos = xml.indexOf("<", match ? TAG.lastIndex : Math.max(next, pos + 1));
  }
  return stack;
}

function repeatedContainer(stack: readonly Frame[]): number {
  for (let depth = stack.length - 2; depth >= 0; depth -= 1) {
    if (stack[depth]?.lastChild === stack[depth + 1]?.name) return depth;
  }
  return -1;
}

export function closeTruncated(xml: string): string | null {
  const stack = walk(xml);
  const depth = repeatedContainer(stack);
  const container = stack[depth];
  if (container === undefined) return null;
  const closers = stack
    .slice(0, depth + 1)
    .reverse()
    .map((frame) => ["</", frame.name, ">"].join(""));
  return xml.slice(0, container.lastChildEnd) + closers.join("");
}
