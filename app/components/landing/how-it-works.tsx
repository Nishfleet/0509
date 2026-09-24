import { Section } from "./section";

const STEPS = [
  {
    title: "Paste your site or handle",
    body: "We read it and draw your card field by field while you watch: what you sell, who it is for, the words you use. Tap any field to fix it. The card is the form.",
  },
  {
    title: "Meet who you’re up against",
    body: "We find your competitors and switch them on for you. Each one has one switch. Off stops the watching and keeps the history; on picks up where it left off.",
  },
  {
    title: "Read one email on Monday",
    body: "Where you stand this week, the three things worth knowing, and the proof behind each. Tap any line for the screenshots. Nothing else lands in your inbox.",
  },
] as const;

export function HowItWorks() {
  return (
    <Section id="how-it-works" kicker="Three steps, no chores" title="How it works">
      <ol className="grid gap-10 md:grid-cols-3 md:gap-8">
        {STEPS.map((step, index) => (
          <li key={step.title} className="border-ink min-w-0 border-t-[1.5px] pt-5">
            <span className="font-mono text-meta text-ink-soft">{String(index + 1).padStart(2, "0")}</span>
            <h3 className="font-display text-title mt-3 font-extrabold uppercase">{step.title}</h3>
            <p className="text-ink-soft mt-3 leading-[1.6]">{step.body}</p>
          </li>
        ))}
      </ol>
    </Section>
  );
}
