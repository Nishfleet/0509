import { SwitchLanding, switchPageLinks, switchPageMeta } from "~/components/switch-landing";
import { SWITCH_PAGES } from "~/lib/switch-pages";

import "~/styles/marketing.css";
const page = SWITCH_PAGES.visualping;

export const links = switchPageLinks(page);
export const meta = switchPageMeta(page);

export default function SwitchVisualpingRoute() {
  return <SwitchLanding page={page} />;
}
