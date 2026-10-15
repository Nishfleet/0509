import { redirect } from "react-router";

import type { Route } from "./+types/signup";

import { pricingPathFor } from "../lib/signup-redirect";

export function loader({ request }: Route.LoaderArgs) {
  return redirect(pricingPathFor(request.url));
}
