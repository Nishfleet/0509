import type { ReactElement, ReactNode } from "react";

import { OtherBrands, type BrandChoice } from "./client-brands";
import { StepBar, type OnboardingStep } from "./step-bar";
import { Footer } from "./footer";
import { ONBOARDING_PAGE } from "./page-heading";

export function OnboardingFrame({
  step,
  heading,
  hideHeading = false,
  otherBrands = [],
  children,
}: {
  step: OnboardingStep;
  heading: string;
  hideHeading?: boolean;
  otherBrands?: BrandChoice[];
  children: ReactNode;
}): ReactElement {
  return (
    <div className={ONBOARDING_PAGE}>
      <header>
        <StepBar current={step} />
      </header>
      <main>
        <h1
          className={hideHeading ? "sr-only" : "mt-10 max-w-[18ch] font-display text-display-3 font-bold text-balance"}
        >
          {heading}
        </h1>
        {children}
        <OtherBrands brands={otherBrands} />
      </main>
      <Footer />
    </div>
  );
}
