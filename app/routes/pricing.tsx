import type { Route } from "./+types/pricing";

import { PricingPage } from "../components/pricing-page";
import { pricingMeta, startSource } from "../lib/pricing-page";

export function meta(_: Route.MetaArgs) {
  return pricingMeta();
}

export function loader({ request }: Route.LoaderArgs) {
  return { source: startSource(new URL(request.url)) };
}

export default function Pricing({ loaderData }: Route.ComponentProps) {
  return <PricingPage source={loaderData.source} />;
}
