// Exact-slug registration for issue #3421 — the issue-specified slug keeps its
// uppercase ChatGPT. The worker's #2955 path canonicalization 301s every
// uppercase public path to the lowercase canonical before React Router runs,
// so `routes/guides.can-chatgpt-monitor-competitor-ads.tsx` is the module that
// serves the page; this file exists so the specified slug stays literal in
// the route table and still resolves if canonicalization is ever bypassed.
export {
  default,
  links,
  meta,
  canChatGPTMonitorCompetitorAdsFaqEntries,
  guideSearchPreviewPath,
} from "./guides.can-chatgpt-monitor-competitor-ads";
