import { Footer } from "../components/footer";

function Section({
  heading,
  paragraphs,
}: {
  heading: string;
  paragraphs: readonly string[];
}) {
  return (
    <section className="mt-14">
      <h2 className="font-display text-[1.15rem] leading-[1.1] font-semibold tracking-[-0.02em]">
        {heading}
      </h2>
      {paragraphs.map((paragraph) => (
        <p className="text-ink-soft mt-4 leading-[1.65]" key={paragraph}>
          {paragraph}
        </p>
      ))}
    </section>
  );
}

const SECTIONS = [
  {
    heading: "Who we track",
    paragraphs: [
      "We track brands, companies, products, and creators who publish under a public handle or domain. The subject has to present itself to the public for commercial or audience reasons.",
      "We never track a private individual. A handle with no public commercial or audience presence is refused at onboarding.",
      "We never track minors, accounts marked private, or anything behind a login.",
    ],
  },
  {
    heading: "How we collect",
    paragraphs: [
      "Each source has a rate limit, and we honour it. A source that blocks us is marked degraded. We do not retry it harder.",
      "We honour robots.txt when we fetch your own site, and when we look for blogs and feeds.",
      "On a competitor's public pages, we fetch what a browser would show a logged-out visitor.",
      "We do not use a paid data provider until that provider and its monthly cost are approved.",
    ],
  },
  {
    heading: "Removal",
    paragraphs: [
      "Any brand or person can ask to be removed from public standing cards and from tracking by any workspace, by email to the address in the footer.",
      "We handle that within 72 hours, by hand, and record the subject, the date, and the action on a takedown row.",
      "A subject on that list is refused at onboarding and dropped from existing workspaces at the next tick, with a one-line note to the owner.",
      "A takedown removes the subject from every public standing card on the next render.",
    ],
  },
] as const;

export default function Terms() {
  return (
    <main className="bg-bone text-ink mx-auto w-full max-w-[46rem] px-6 py-16 sm:py-24">
      <header>
        <a
          className="font-display text-ink text-base font-bold tracking-[-0.03em]"
          href="/"
        >
          05<span className="bg-accent text-on-accent px-[5px]">09</span>
        </a>
        <h1 className="font-display mt-8 text-[clamp(1.75rem,3.6vw,2.9rem)] leading-[1.15] font-semibold tracking-[-0.02em]">
          Terms
        </h1>
        <p className="text-ink-soft mt-6 leading-[1.65]">
          This page says what we will and will not do, and how to be removed.{" "}
          <a
            className="text-ink underline decoration-1 underline-offset-4"
            href="/privacy"
          >
            What we collect, and how long we keep it, is on the privacy page.
          </a>
        </p>
      </header>
      {SECTIONS.map((section) => (
        <Section heading={section.heading} key={section.heading} paragraphs={section.paragraphs} />
      ))}
      <Footer />
    </main>
  );
}
