export const PROBLEMS = {
  invalid_token: {
    status: 401,
    description: "Send an API key from Settings as 'Authorization: Bearer <key>'.",
  },
  no_workspace: { status: 403, description: "Finish signing up at 0509.io first." },
  plan: { status: 403, description: "This plan doesn't include API access." },
  forbidden_origin: { status: 403, description: "This origin may not call the MCP server." },
  rate_limited: { status: 429, description: "Too many requests. Slow down and retry in a minute." },
} as const;

export type ProblemCode = keyof typeof PROBLEMS;
