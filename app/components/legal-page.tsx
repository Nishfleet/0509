import { Footer, SupportLink } from "./footer";
import type { LegalDocument, LegalSection } from "../lib/legal/document";
import { LEGAL_UPDATED } from "../lib/legal/document";

const body = "text-ink-soft mt-4 leading-[1.65]";

const updatedLabel = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
}).format(new Date(`${LEGAL_UPDATED}T00:00:00Z`));

function Paragraphs({ items }: { items: readonly string[] | undefined }) {
  return items?.map((paragraph) => (
    <p className={body} key={paragraph}>
      {paragraph}
    </p>
  ));
}

function Section({ section }: { section: LegalSection }) {
  return (
    <section aria-labelledby={section.id} className="mt-14 scroll-mt-6">
      <h2
        className="font-display text-[1.15rem] leading-[1.1] font-semibold tracking-[-0.02em]"
        id={section.id}
      >
        {section.heading}
      </h2>
      <Paragraphs items={section.paragraphs} />
      {section.list === undefined ? null : (
        <ul className="text-ink-soft mt-4 list-disc space-y-2 pl-5 leading-[1.65]">
          {section.list.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
      {section.entries === undefined ? null : (
        <dl className="border-line mt-6 border-t">
          {section.entries.map((entry) => (
            <div className="border-line grid gap-1 border-b py-4 sm:grid-cols-[13rem_1fr] sm:gap-6" key={entry.term}>
              <dt className="text-ink font-medium">{entry.term}</dt>
              <dd className="text-ink-soft space-y-1 leading-[1.6]">
                {entry.details.map((detail) => (
                  <p key={detail}>{detail}</p>
                ))}
              </dd>
            </div>
          ))}
        </dl>
      )}
      <Paragraphs items={section.closing} />
      {section.link === undefined ? null : (
        <p className={body}>
          <a className="text-ink underline decoration-1 underline-offset-4" href={section.link.href}>
            {section.link.label}
          </a>
        </p>
      )}
    </section>
  );
}

export function LegalPage({ doc }: { doc: LegalDocument }) {
  return (
    <div className="bg-bone text-ink mx-auto w-full max-w-[46rem] px-6 py-16 sm:py-24">
      <header>
        <a className="font-display text-ink text-base font-bold tracking-[-0.03em]" href="/">
          05<span className="bg-green text-on-green px-[5px]">09</span>
        </a>
      </header>
      <main className="mt-8">
        <h1 className="font-display text-[clamp(1.75rem,3.6vw,2.9rem)] leading-[1.15] font-semibold tracking-[-0.02em]">
          {doc.title}
        </h1>
        <p className="text-ink-soft mt-4 font-mono text-[0.72rem] tracking-[0.06em]">
          Last updated <time dateTime={LEGAL_UPDATED}>{updatedLabel}</time>
        </p>
        <p className="text-ink-soft mt-6 leading-[1.65]">{doc.intro}</p>
        <nav aria-label="On this page" className="border-line mt-10 border-y py-5">
          <ol className="grid gap-x-6 gap-y-2 text-[0.92rem] sm:grid-cols-2">
            {doc.sections.map((section) => (
              <li key={section.id}>
                <a className="text-ink-soft hover:text-ink underline-offset-4 hover:underline" href={`#${section.id}`}>
                  {section.heading}
                </a>
              </li>
            ))}
            <li>
              <a className="text-ink-soft hover:text-ink underline-offset-4 hover:underline" href="#contact">
                Contact
              </a>
            </li>
          </ol>
        </nav>
        {doc.sections.map((section) => (
          <Section key={section.id} section={section} />
        ))}
        <section aria-labelledby="contact" className="mt-14 scroll-mt-6">
          <h2 className="font-display text-[1.15rem] leading-[1.1] font-semibold tracking-[-0.02em]" id="contact">
            Contact
          </h2>
          <p className={body}>
            Email <SupportLink />. A person reads every message.
          </p>
        </section>
      </main>
      <Footer />
    </div>
  );
}
