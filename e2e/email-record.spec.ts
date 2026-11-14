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

test("a real sign-in leaves a send record with the sent subject and no address", async ({ page }) => {
  test.setTimeout(180_000);
  const email = `e2e+${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}@0509.io`;
  createdEmail = email;
  const count = () =>
    readPreview((db) => db.prepare("SELECT COUNT(*) AS n FROM send_attempt WHERE kind = 'sign_in'").get()) as {
      n: number;
    };
  const before = count().n;

  await signInWithMagicLink(page, email, null);

  expect(count().n).toBe(before + 1);
  const newest = readPreview((db) =>
    db
      .prepare(
        "SELECT kind, subject, provider_message, status, error, workspace_id FROM send_attempt WHERE kind = 'sign_in' ORDER BY attempted_at DESC LIMIT 1",
      )
      .get(),
  );
  expect(newest).toMatchObject({ kind: "sign_in", status: "sent", error: null, workspace_id: null });
  expect(newest?.subject).toEqual(expect.stringContaining("Five to Nine"));
  const dump = JSON.stringify(readPreview((db) => db.prepare("SELECT * FROM send_attempt").all()));
  expect(dump).not.toContain(email);
});
