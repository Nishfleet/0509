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
      "We never track a private individual. We never track minors, accounts marked private, or anything behind a login.",
    ],
  },
  {
    heading: "What we collect",
    paragraphs: [
      "We collect public pages, public posts, public ad libraries, public feeds, and screenshots of public pages.",
      "We do not collect direct messages, private groups, or purchased personal data.",
      "A mention keeps the headline, the URL, the source, the date, and the excerpt needed to show the mark. We never keep the full text of a third-party post.",
    ],
  },
  {
    heading: "How long we keep it",
    paragraphs: [
      "Raw snapshots and screenshots are kept one year. After that, only the before-and-after marks and summaries remain.",
      "Incident records for a workspace's own site are kept one year.",
    ],
  },
  {
    heading: "Deletion",
    paragraphs: [
      "Deleting a workspace deletes every row it owns and every stored file under its prefix, within one run, and stops every email.",
      'Removing a competitor keeps the history, unless you choose "remove and forget", which deletes that competitor\'s signals for that workspace.',
    ],
  },
  {
    heading: "Removal",
    paragraphs: [
      "Any brand or person can ask to be removed from public standing cards and from tracking by any workspace, by email to the address in the footer.",
      "We handle that within 72 hours, by hand, and record the subject, the date, and the action on a takedown row.",
      "A subject on that list is refused at onboarding and dropped from existing workspaces at the next tick, with a one-line note to the owner.",
    ],
  },
] as const;

export default function Privacy() {
  return (
    <main className="bg-bone text-ink mx-auto w-full max-w-[46rem] px-6 py-16 sm:py-24">
      <header>
        <a
          className="font-display text-ink text-base font-bold tracking-[-0.03em]"
          href="/"
        >
          05<span className="bg-green text-on-green px-[5px]">09</span>
        </a>
        <h1 className="font-display mt-8 text-[clamp(1.75rem,3.6vw,2.9rem)] leading-[1.15] font-semibold tracking-[-0.02em]">
          Privacy
        </h1>
        <p className="text-ink-soft mt-6 leading-[1.65]">
          This page says what we collect, how long we keep it, how to be removed, and who to email.
        </p>
      </header>
      {SECTIONS.map((section) => (
        <Section heading={section.heading} key={section.heading} paragraphs={section.paragraphs} />
      ))}
      <Footer />
    </main>
  );
}
