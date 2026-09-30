import { PLANS, TRIAL_TERMS } from "./billing/plans";
import { WATCHED_NOUNS, WATCHED_ORIGINS } from "./coverage";

export interface FaqEntry {
  question: string;
  answer: string;
}

const priceList = PLANS.map((plan) => `${plan.name} €${String(plan.monthlyPriceEur)} a month`).join(", ");

export const FAQ: readonly FaqEntry[] = [
  {
    question: "What is Five to Nine?",
    answer: `Five to Nine is a competitor tracker for founders, brands and creators. It watches your rivals' ${WATCHED_NOUNS}, ranks you against them every week, and emails you one brief on Monday with a screenshot behind every change.`,
  },
  {
    question: "Do I need to know who my competitors are?",
    answer:
      "No. Paste your website or handle and we find the brands you compete with. Each one gets a switch, so you keep the ones that matter and add any we missed.",
  },
  {
    question: "How is this different from news alerts?",
    answer:
      "Alerts send you links. We send you what changed: the old wording struck through, the new wording marked, the screenshot that proves it, and a ranking of who moved most this week.",
  },
  {
    question: "Where does the data come from?",
    answer: `Public sources only: ${WATCHED_ORIGINS}. We never log in anywhere, never track private individuals, and never buy personal data.`,
  },
  {
    question: "Why not just check my competitors by hand?",
    answer:
      "You can, and for one rival it works. Five to Nine does it for every rival at once, keeps the before and after screenshot as proof, and ranks who moved most, so one Monday email replaces the tab-checking.",
  },
  {
    question: "Is my data private?",
    answer:
      "Yes. Nothing about your workspace sits on a public page, we never sell your data, and you can ask for a copy or for deletion at any time. Any brand can also ask to be removed from tracking.",
  },
  {
    question: "How much does it cost?",
    answer: `${priceList}. ${TRIAL_TERMS}`,
  },
  {
    question: "Can my AI agent read it?",
    answer:
      "Yes. Every plan includes a read-only API and an MCP server, so Claude, Cursor or ChatGPT can read the same standing, changes and alerts you see, and nothing outside your workspace.",
  },
];
