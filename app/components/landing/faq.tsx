import { FAQ } from "../../lib/faq";
import { Section } from "./section";

export function Faq() {
  return (
    <Section id="faq" kicker="Straight answers" title="Questions">
      <div className="grid gap-x-12 md:grid-cols-2">
        {FAQ.map((entry) => (
          <div key={entry.question} className="min-w-0 border-t border-line py-6">
            <h3 className="font-display text-title font-extrabold uppercase">{entry.question}</h3>
            <p className="mt-3 leading-[1.6] text-ink-soft">{entry.answer}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}
