import { env } from "cloudflare:workers";

import { createAuth } from "./auth.server";
import { passkeyLabel } from "./passkey-label";

export async function readPasskeys(request: Request) {
  const rows = await createAuth(env).api.listPasskeys({ headers: request.headers });
  return rows.map((row) => ({ id: row.id, label: passkeyLabel(row.name, row.createdAt) }));
}
