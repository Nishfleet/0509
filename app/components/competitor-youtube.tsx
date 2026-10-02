import type { ReactElement } from "react";
import { Form } from "react-router";

import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { YOUTUBE_LINK_MAX } from "../lib/competitor-youtube";

const HEADING = "mb-3 font-mono text-eyebrow text-ink-soft uppercase";

export interface CompetitorYoutubeProps {
  url: string | null;
  error: string | null;
}

export function CompetitorYoutube({ url, error }: CompetitorYoutubeProps): ReactElement {
  return (
    <section data-section="youtube" aria-labelledby="competitor-youtube" className="min-w-0">
      <h2 id="competitor-youtube" className={HEADING}>
        Their YouTube channel
      </h2>
      <p data-slot="youtube-current" className="text-meta [overflow-wrap:anywhere] text-ink-soft">
        {url ?? "We haven't found one. Paste it and we'll watch their videos."}
      </p>
      <Form method="post" className="mt-3 flex flex-col gap-3">
        <input type="hidden" name="intent" value="youtube" />
        <label htmlFor="competitor-youtube-url" className="text-meta">
          {url === null ? "Channel link" : "Wrong channel? Paste the right link"}
        </label>
        <Input
          id="competitor-youtube-url"
          name="youtube"
          type="text"
          inputMode="url"
          autoComplete="off"
          required
          maxLength={YOUTUBE_LINK_MAX}
          placeholder="youtube.com/@theirname"
          aria-invalid={error === null ? undefined : true}
          aria-describedby={error === null ? undefined : "competitor-youtube-error"}
        />
        {error === null ? null : (
          <p id="competitor-youtube-error" role="alert" className="text-[0.95rem]">
            {error}
          </p>
        )}
        <Button type="submit" variant="secondary" className="self-start">
          Save channel
        </Button>
      </Form>
    </section>
  );
}
