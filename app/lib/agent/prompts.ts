export interface AgentPrompt {
  title: string;
  text: string;
}

export const AGENT_PROMPTS: readonly AgentPrompt[] = [
  {
    title: "Monday catch-up",
    text: "Using Five to Nine, tell me what changed at my competitors this week, which two things matter most, and what I should do about each.",
  },
  {
    title: "Pricing check",
    text: "Using Five to Nine, list any pricing or plan changes my competitors made recently with the old and new line, and tell me which one I should look at first.",
  },
  {
    title: "Where I stand",
    text: "Using Five to Nine, show where I rank against my competitors this week and who moved since last week.",
  },
];
