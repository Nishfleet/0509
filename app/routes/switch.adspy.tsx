import { SwitchLanding, switchPageLinks, switchPageMeta } from "~/components/switch-landing";
import { SWITCH_PAGES } from "~/lib/switch-pages";

import "~/styles/marketing.css";

const page = SWITCH_PAGES.adspy;

export const links = switchPageLinks(page);
export const meta = switchPageMeta(page);

export default function SwitchAdspyRoute() {
  return <SwitchLanding page={page} />;
}
