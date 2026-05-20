import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

export async function loader({ context, request }: LoaderFunctionArgs) {
  const { getEnv } = await import("~/lib/context.server");
  const { previewDodo0509PlanPrices } = await import("~/lib/dodo-pricing.server");
  const preview = await previewDodo0509PlanPrices({
    env: getEnv(context),
    request,
  });

  return Response.json(preview, {
    headers: {
      "Cache-Control": preview.available ? "private, max-age=300" : "no-store",
    },
  });
}

export function action(_args: ActionFunctionArgs) {
  return Response.json(
    { error: "Method not allowed. Use GET." },
    { status: 405, headers: { Allow: "GET" } },
  );
}
