import type { ReactElement } from "react";
import { Form, useNavigation } from "react-router";

import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { SITE_LINK_MAX } from "../lib/competitor-site";

const HEADING = "mb-3 font-mono text-eyebrow text-ink-soft uppercase";

export interface CompetitorSiteProps {
  url: string | null;
  error: string | null;
}

export function CompetitorSite({ url, error }: CompetitorSiteProps): ReactElement {
  const navigation = useNavigation();
  const saving = navigation.state !== "idle" && navigation.formData?.get("intent") === "site";
  return (
    <section data-section="other-site" aria-labelledby="competitor-site" className="min-w-0">
      <h2 id="competitor-site" className={HEADING}>
        Another website of theirs
      </h2>
      <p data-slot="site-current" className="text-meta [overflow-wrap:anywhere] text-ink-soft">
        {url ??
          "None yet. If their main site keeps us out, paste another one of theirs, like a corporate or press site."}
      </p>
      <Form method="post" className="mt-3 flex flex-col gap-3">
        <input type="hidden" name="intent" value="site" />
        <label htmlFor="competitor-site-url" className="text-meta">
          {url === null ? "Website" : "Use a different website"}
        </label>
        <Input
          id="competitor-site-url"
          name="site"
          type="text"
          inputMode="url"
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="go"
          required
          maxLength={SITE_LINK_MAX}
          placeholder="adidas-group.com"
          aria-invalid={error === null ? undefined : true}
          aria-describedby={error === null ? undefined : "competitor-site-error"}
        />
        {error === null ? null : (
          <p id="competitor-site-error" role="alert" className="text-[0.95rem]">
            {error}
          </p>
        )}
        <Button type="submit" variant="secondary" className="self-start" disabled={saving}>
          {saving ? "Checking…" : "Watch this website"}
        </Button>
      </Form>
    </section>
  );
}
