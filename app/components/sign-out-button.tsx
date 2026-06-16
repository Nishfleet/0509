import { Form, useNavigation } from "react-router";

export function SignOutButton() {
  const navigation = useNavigation();
  const pending = navigation.state !== "idle";

  return (
    <Form action="/auth/logout" method="post">
      <button className="f9-secondary-button f9-sign-out-button" disabled={pending} type="submit">
        {pending ? "Signing out..." : "Sign out"}
      </button>
    </Form>
  );
}
