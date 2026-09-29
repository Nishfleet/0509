import { ExampleMark } from "./example-mark";
import { Section } from "./section";

export function TheMark() {
  return (
    <Section
      id="mark"
      kicker="The mark"
      title="Every change, in one line."
      lead="When a brand you watch changes something, we strike the old words and put the new ones on a green marker, with the screenshot and a link to where we saw it. That is the whole vocabulary. Nothing on screen needs a legend."
    >
      <figure className="border-[1.5px] border-ink bg-card p-6 sm:p-10">
        <ExampleMark before="€29 a month" after="€19 a month" className="text-mark-lg" />
        <figcaption className="mt-6 font-mono text-meta text-ink-soft">
          A rival’s homepage · both screenshots kept · one tap to the page itself
        </figcaption>
      </figure>
    </Section>
  );
}
