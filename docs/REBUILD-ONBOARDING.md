# Onboarding contract: the first sixty seconds

Umbrella #3842. Author: Fable. Checked by the Opus deputy. Pairs with the identity card engine (#3885), competitor discovery (#3884), the Jev contract and the build brief.

## The promise, restated as a budget

One input. Under 30 seconds to a confirmed brand card. Under 60 seconds to "here's who you're up against". Home is never empty, even on second zero. No form, ever: the card is the form.

## Steps and states

**1. Sign in.** Magic link or passkey (better-auth as shipped). No password screen. After sign-in, a workspace exists and the user lands on step 2 immediately; nothing else is asked.

**2. One input.** Placeholder: "your website, or a handle". Accepts a domain, a URL, `@handle`, a channel URL. Normalised by the identity engine; the user never picks a type.
- While it works (target under 30 s): the card draws itself field by field as each arrives (name, logo, description, category, socials, ad libraries found). Real progress, not a spinner. Each field that is still empty says what will fill it ("logo: looking on the site").
- Bot-blocked or slow site: the card still appears with whatever the ad libraries, search and socials gave; the site fields say "we'll fill this on the first crawl, within the hour".
- Unknown input (nothing found anywhere): one line, "we couldn't find anything for that, try the main website", input stays focused. No error page.

**3. Confirm the card.** Every field is editable in place (tap to edit, iOS style). Fields Jev was unsure about (D7 between) are outlined and read "check this". One action: "That's me". No skip: the card is the workspace's identity.

**4. Who you're up against.** Discovery ran in the background since step 2. Shows the competitors Jev accepted (D1 p >= 0.9) as ON, and the maybes as a short second list the user can flip on. "Add a competitor" is a single input that goes through the same identity engine. No minimum, no maximum in v1 (plan limits apply later, at the plan gate, not here). One action: "Start watching".
- If discovery found nothing yet (slow sources): the screen says "we're still looking, add one you know and we'll keep going", and continues in the background; the Competitors page fills as results land.

**5. Home, second zero.** The first snapshots, ad pulls and mention pulls were queued at step 4. Home shows the greeting, the chip row, and a "first file" panel that says exactly what is being gathered and when the first read-this-first arrives (a real time from the Workflow, not "soon"). Rows fill live as signals land. The weekly brief date is shown.

## Rules

- Nothing on these screens is a form field with a label above it. Inline, editable, one action per screen.
- Back always works and loses nothing; the card and competitor list are saved on every edit.
- Timings are measured and stored per onboarding (input to card, card to competitors, competitors to first signal). Anything over budget is a defect, filed by the audit packet, not a tolerance.
- One brand per workspace in v1. A second brand is a second workspace (a row, not a redesign). Creators and companies use the same flow.
- The plan gate (free vs paid) is not in onboarding. It appears the first time a paid thing is asked for, and it says the price on the button.

## Proof required in every onboarding packet

Three real runs, screen-recorded with Playwright at 1440 and 390, on a company domain, a creator handle, and a bot-blocking brand site: the timings for each stage, the card fields filled and by which source, the competitor list with Jev verdict ids, and the first signal's arrival time. No invented brands.
