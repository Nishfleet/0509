import { redirect } from "react-router";

import { readSession } from "./auth.server";

export async function requireSession(request: Request) {
  const session = await readSession(request);
  if (!session) throw redirect("/login");
  return session;
}
