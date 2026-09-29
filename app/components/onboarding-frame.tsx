import type { ReactElement, ReactNode } from "react";

import { StepBar } from "./step-bar";
import { Footer } from "./footer";
import { ONBOARDING_PAGE } from "./page-heading";

export function OnboardingFrame({
  step,
  heading,
  hideHeading = false,
  children,
}: {
  step: 1 | 2 | 3;
  heading: string;
  hideHeading?: boolean;
  children: ReactNode;
}): ReactElement {
  return (
    <div className={ONBOARDING_PAGE}>
      <header>
        <StepBar current={step} />
      </header>
      <main>
        <h1 className={hideHeading ? "sr-only" : "mt-10 font-display text-display-2 font-extrabold uppercase"}>
          {heading}
        </h1>
        {children}
      </main>
      <Footer />
    </div>
  );
}
