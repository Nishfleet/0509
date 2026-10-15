import type { CompetitorFormErrors } from "../lib/competitor-form-errors";
import { CompetitorForget } from "./competitor-forget";
import { CompetitorNote } from "./competitor-note";
import { CompetitorRename } from "./competitor-rename";
import { CompetitorSite } from "./competitor-site";
import { CompetitorYoutube } from "./competitor-youtube";

export function CompetitorFoot(props: {
  name: string;
  domain: string;
  note: string;
  youtubeUrl: string | null;
  siteUrl: string | null;
  errors: CompetitorFormErrors | undefined;
}) {
  return (
    <>
      <CompetitorRename name={props.name} domain={props.domain} result={props.errors} />
      <CompetitorNote
        note={props.note}
        error={props.errors?.noteError ?? null}
        saved={props.errors?.noteSaved === true}
      />
      <CompetitorSite url={props.siteUrl} error={props.errors?.siteError ?? null} />
      <CompetitorYoutube url={props.youtubeUrl} error={props.errors?.youtubeError ?? null} />
      <CompetitorForget name={props.name} error={props.errors?.forgetError ?? null} />
    </>
  );
}
