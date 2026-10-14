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
  errors:
    | {
        forgetError: string | null;
        youtubeError: string | null;
        siteError: string | null;
        nameError: string | null;
        noteError: string | null;
        renamed: boolean;
      }
    | undefined;
}) {
  return (
    <>
      <CompetitorRename name={props.name} domain={props.domain} result={props.errors} />
      <CompetitorNote note={props.note} error={props.errors?.noteError ?? null} />
      <CompetitorSite url={props.siteUrl} error={props.errors?.siteError ?? null} />
      <CompetitorYoutube url={props.youtubeUrl} error={props.errors?.youtubeError ?? null} />
      <CompetitorForget name={props.name} error={props.errors?.forgetError ?? null} />
    </>
  );
}
