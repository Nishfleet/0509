import type { ReactElement, ReactNode } from "react";

import { StepBar } from "./step-bar";
import { Footer } from "./footer";

export function OnboardingFrame({
  step,
  heading,
  hideHeading = false,
  className,
  headingClassName,
  children,
}: {
  step: 1 | 2 | 3;
  heading: string;
  hideHeading?: boolean;
  className?: string;
  headingClassName?: string;
  children: ReactNode;
}): ReactElement {
  return (
    <>
      <header>
        <StepBar current={step} />
      </header>
      <main className={className}>
        <h1 className={hideHeading ? "sr-only" : headingClassName}>{heading}</h1>
        {children}
      </main>
      <Footer />
    </>
  );
}
