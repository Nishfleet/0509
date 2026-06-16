import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";

async function handleAuth(request: Request, context: LoaderFunctionArgs["context"]) {
  void request;
  void context;
  return new Response("Five to Nine auth is handled by Stytch B2B routes.", {
    status: 404,
  });
}

export async function loader({ request, context }: LoaderFunctionArgs) {
  return handleAuth(request, context);
}

export async function action({ request, context }: ActionFunctionArgs) {
  return handleAuth(request, context);
}
