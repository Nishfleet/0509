import { SwitchLanding, switchPageLinks, switchPageMeta } from "~/components/switch-landing";
import { SWITCH_PAGES } from "~/lib/switch-pages";

const page = SWITCH_PAGES.panoramata;

export const links = switchPageLinks(page);
export const meta = switchPageMeta(page);

export default function SwitchPanoramataRoute() {
  return <SwitchLanding page={page} />;
}
