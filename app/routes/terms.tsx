import { Link } from "react-router";

import {
  PLANS,
  SECTIONS,
  SUPPORT_ADDRESS,
  type Section,
} from "../lib/terms-copy";

function SectionBlock({ heading, paragraphs }: Section) {
  return (
    <section className="mt-14">
      <h2 className="font-display text-[1.15rem] leading-[1.1] font-semibold tracking-[0.02em] uppercase">
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

export default function Terms() {
  return (
    <main className="mx-auto w-full max-w-[46rem] px-6 py-16 sm:py-24">
      <header>
        <Link
          className="text-ink-faint hover:text-ink font-mono text-[0.72rem] tracking-[0.06em] underline decoration-1 underline-offset-4 transition-colors"
          to="/"
        >
          0509.io
        </Link>
        <h1 className="font-display mt-8 text-[clamp(1.7rem,3.6vw,2.8rem)] leading-[1.06] font-semibold tracking-[-0.035em]">
          Terms
        </h1>
        <p className="text-ink-soft mt-6 leading-[1.65]">
          These terms cover the plans, the trial, how to cancel and how to delete a
          workspace. They are written to be read by someone about to put a card down.
        </p>
      </header>

      <section className="mt-14">
        <table className="border-line w-full border-collapse text-left">
          <caption className="sr-only">
            Plan name, monthly price and what the plan includes
          </caption>
          <thead>
            <tr className="border-line border-b">
              <th
                className="text-ink-faint py-3 pr-4 font-mono text-[0.72rem] font-normal tracking-[0.16em] uppercase"
                scope="col"
              >
                Plan
              </th>
              <th
                className="text-ink-faint py-3 pr-4 font-mono text-[0.72rem] font-normal tracking-[0.16em] uppercase"
                scope="col"
              >
                Price
              </th>
              <th
                className="text-ink-faint py-3 font-mono text-[0.72rem] font-normal tracking-[0.16em] uppercase"
                scope="col"
              >
                What you get
              </th>
            </tr>
          </thead>
          <tbody>
            {PLANS.map((plan) => (
              <tr className="border-line border-b" key={plan.name}>
                <th className="py-3 pr-4 font-normal" scope="row">
                  {plan.name}
                </th>
                <td className="py-3 pr-4 font-mono">{plan.price}</td>
                <td className="text-ink-soft py-3">{plan.cadence}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {SECTIONS.map((section) => (
        <SectionBlock {...section} key={section.heading} />
      ))}

      <footer className="border-line text-ink-faint mt-14 border-t pt-7 text-[0.88rem] leading-[1.5]">
        <p>
          Read the{" "}
          <Link className="underline decoration-1 underline-offset-4" to="/privacy">
            privacy page
          </Link>{" "}
          for what we collect, how long we keep it and how to be removed from a public card.
        </p>
        <p className="mt-3">
          Removal requests and anything about these terms:{" "}
          <a
            className="underline decoration-1 underline-offset-4"
            href={`mailto:${SUPPORT_ADDRESS}`}
          >
            {SUPPORT_ADDRESS}
          </a>
          . Handled within 72 hours, by a person.
        </p>
      </footer>
    </main>
  );
}
