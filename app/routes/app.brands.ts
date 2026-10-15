import type { Route } from "./+types/app.brands";

import { redirect } from "react-router";
import { z } from "zod";

import { BRAND_NAME_INVALID, addClientBrand, switchClientBrand } from "../lib/client-brands.server";
import { sessionContext } from "../lib/require-session.server";

const brandForm = z.discriminatedUnion("intent", [
  z.object({ intent: z.literal("switch"), workspaceId: z.string() }),
  z.object({ intent: z.literal("add"), name: z.string() }),
]);

export function loader() {
  return redirect("/app/settings");
}

export async function action({ request, context }: Route.ActionArgs) {
  const { user } = context.get(sessionContext);
  const parsed = brandForm.safeParse(Object.fromEntries(await request.formData()));
  if (!parsed.success) return { message: BRAND_NAME_INVALID };
  if (parsed.data.intent === "switch") {
    await switchClientBrand(user.id, parsed.data.workspaceId);
    return redirect("/app");
  }
  const outcome = await addClientBrand(user, parsed.data.name);
  if (outcome.status === "refused") return { message: outcome.message };
  return redirect("/app");
}
