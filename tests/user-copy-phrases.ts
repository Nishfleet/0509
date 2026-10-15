export interface BannedPhrase {
  readonly pattern: RegExp;
  readonly instead: string;
}

export const BANNED_PHRASES: readonly BannedPhrase[] = [
  { pattern: /\boops\b/i, instead: "say what happened and what to do next" },
  { pattern: /something went wrong/i, instead: "say what failed" },
  { pattern: /an error occurred/i, instead: "say what failed" },
  { pattern: /\bsimply\b/i, instead: "drop it, the step is not simple to everyone" },
  { pattern: /\bjust\b(?! now\b)/i, instead: "drop it, or say exactly what is needed" },
  { pattern: /please try again later/i, instead: "say when to try again and why" },
  { pattern: /\bclick here\b/i, instead: "label the link with where it goes" },
  {
    pattern: /\b(we could not|could not be shown|you cannot|we cannot)\b/i,
    instead: "say couldn't and can't, like the rest of the app",
  },
  { pattern: /\w!(?=\s|$)/, instead: "no exclamation marks in what people read" },
];

export const TITLE_CASE_LABEL_EXCEPTIONS: readonly string[] = ["Five to Nine", "Claude Code", "Claude Desktop"];

export const EXEMPT_PATHS: readonly { readonly path: string; readonly why: string }[] = [
  { path: "app/components/ui/", why: "stock shadcn class strings, never read by people" },
  { path: "app/lib/fetch/transport.server.ts", why: "matches other sites' bot-wall pages, never shown" },
  { path: "app/lib/legal/", why: "legal text keeps its formal register" },
];
