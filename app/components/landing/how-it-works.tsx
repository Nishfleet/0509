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
      <ol className="border-line border-t">
        {STEPS.map((step, index) => (
          <li
            key={step.title}
            className="border-line grid grid-cols-[52px_minmax(0,1fr)] items-start gap-3.5 border-b py-5.5 sm:grid-cols-[74px_minmax(0,1fr)] sm:gap-4.5"
          >
            <span className="font-display text-[1.6rem] leading-none font-extrabold tracking-[-0.04em] text-ink-faint sm:text-[2.1rem]">
              {String(index + 1).padStart(2, "0")}
            </span>
            <div className="min-w-0">
              <h3 className="font-display text-title font-extrabold uppercase">{step.title}</h3>
              <p className="text-ink-soft mt-2 max-w-[60ch] leading-[1.6]">{step.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </Section>
  );
}
