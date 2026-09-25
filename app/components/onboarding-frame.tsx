import type { ReactElement, ReactNode } from "react";

import { StepBar } from "./step-bar";
import { Footer } from "./footer";

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
    <>
      <header>
        <StepBar current={step} />
      </header>
      <main>
        <h1 className={hideHeading ? "sr-only" : undefined}>{heading}</h1>
        {children}
      </main>
      <Footer />
    </>
  );
}
