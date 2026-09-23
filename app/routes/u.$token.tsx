import type { Route } from "./+types/u.$token";

import { unsubscribe } from "../lib/unsubscribe.server";

export async function loader({ params }: Route.LoaderArgs) {
  return unsubscribe(params.token);
}

export async function action({ params }: Route.ActionArgs) {
  return unsubscribe(params.token);
}
