import type { Route } from "./+types/privacy";

import { LegalPage } from "../components/legal-page";
import { legalMeta } from "../lib/legal/meta";
import { PRIVACY } from "../lib/legal/privacy";

export function meta(_: Route.MetaArgs) {
  return legalMeta(PRIVACY);
}

export default function Privacy() {
  return <LegalPage doc={PRIVACY} />;
}
