import type { ReactElement } from "react";
import { Form, useNavigation } from "react-router";

import { Button } from "./ui/button";

export function SubjectConfirm({ subject, raw }: { subject: string; raw: string }): ReactElement {
  const navigation = useNavigation();
  const answering = navigation.state !== "idle";
  const business = answering && navigation.formData?.get("answer") === "business";
  const person = answering && navigation.formData?.get("answer") === "person";
  return (
    <Form method="post" action="/onboarding" className="mt-6 flex flex-col gap-3">
      <p>Is {subject} a business or a public creator?</p>
      <input type="hidden" name="subject" value={raw} />
      <div className="flex flex-wrap gap-3">
        <Button type="submit" name="answer" value="business" size="lg" disabled={answering}>
          {business ? "Saving…" : "Yes, a business or creator"}
        </Button>
        <Button type="submit" name="answer" value="person" variant="secondary" size="lg" disabled={answering}>
          {person ? "Saving…" : "No, it's a person"}
        </Button>
      </div>
    </Form>
  );
}
