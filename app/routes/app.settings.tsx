import { requireSession } from "../lib/require-session.server";

export async function loader({ request }: { request: Request }) {
  const session = await requireSession(request);
  return { email: session.user.email };
}

export default function Page({ loaderData }: { loaderData: { email: string } }) {
  return (
    <main>
      <h1>Settings</h1>
      <p>Signed in as {loaderData.email}</p>
    </main>
  );
}
