import { SwitchLanding, switchPageLinks, switchPageMeta } from "~/components/switch-landing";
import { SWITCH_PAGES } from "~/lib/switch-pages";

const page = SWITCH_PAGES.magicbrief;

export const links = switchPageLinks(page);
export const meta = switchPageMeta(page);

export default function SwitchMagicBriefRoute() {
  return <SwitchLanding page={page} />;
}
