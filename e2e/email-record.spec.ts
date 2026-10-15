import { createHash } from "node:crypto";

import { expect, test } from "./test";

import { deleteCreatedAccount, isLocalLane, readPreview, signInWithMagicLink } from "./inbox";

test.skip(!isLocalLane(), "reads the local database the preview Worker writes");

let createdEmail = "";
test.afterEach(async ({ page }) => {
  if (createdEmail === "") return;
  try {
    await deleteCreatedAccount(page, createdEmail);
  } finally {
    createdEmail = "";
  }
});

test("a real sign-in leaves a send record with the sent subject and a hashed address, never the address", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const email = `e2e+${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}@0509.io`;
  createdEmail = email;

  await signInWithMagicLink(page, email, null);

  const hash = createHash("sha256").update(email.toLowerCase()).digest("hex");
  const rows = readPreview((db) =>
    db
      .prepare(
        "SELECT kind, subject, provider_id, status, error, workspace_id FROM send_attempt WHERE recipient_hash = ?",
      )
      .all(hash),
  );
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ kind: "sign_in", status: "sent", error: null, workspace_id: null });
  expect(rows[0]?.subject).toEqual(expect.stringContaining("Five to Nine"));
  const dump = JSON.stringify(readPreview((db) => db.prepare("SELECT * FROM send_attempt").all()));
  expect(dump).not.toContain(email);
});
