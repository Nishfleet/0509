import { requireSession } from "../lib/require-session.server";

export async function loader({ request, context }: { request: Request; context: { cloudflare: { env: never } } }) {
  const session = await requireSession(request, context.cloudflare.env);
  return { email: session.user.email };
}

export default function Page({ loaderData }: { loaderData: { email: string } }) {
  return (
    <main>
      <h1>Alerts</h1>
      <p>Signed in as {loaderData.email}</p>
    </main>
  );
}
