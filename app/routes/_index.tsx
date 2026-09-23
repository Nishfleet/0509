import { Footer } from "../components/footer";
import { Header } from "../components/landing/header";
import { Hero } from "../components/landing/hero";
import { HowItWorks } from "../components/landing/how-it-works";
import { Mark } from "../components/landing/mark";
import { Price } from "../components/landing/price";
import { Standing } from "../components/landing/standing";
import { Ticker } from "../components/landing/ticker";
import { WhatWeWatch } from "../components/landing/what-we-watch";

export default function Landing() {
  return (
    <main className="bg-bone text-ink mx-auto w-full max-w-[64rem] px-6 py-12 sm:px-12 sm:py-16">
      <Ticker />
      <Header />
      <Hero />
      <Mark />
      <Standing />
      <HowItWorks />
      <WhatWeWatch />
      <Price />
      <Footer />
    </main>
  );
}
