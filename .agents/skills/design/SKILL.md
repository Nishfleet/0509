---
name: design
description: Build new screens inside the 0509 design system. Extend the nearest a-final keyframe, use only @theme tokens and the shadcn kit, pull Mobbin references when no keyframe is near, and screenshot at 1440 and 390 before opening a PR.
---

# Design

DESIGN.md at the repo root is the system. `docs/design-directions/a-final/` holds the keyframes: landing, onboarding, home, competitor, alerts and settings, each as HTML with desktop-1440 and mobile-390 renders. Figma is not a source; the code tokens are the only source of truth.

## Start from the nearest keyframe

A new screen extends the nearest keyframe in `docs/design-directions/a-final/`. Take its structure and ingredients; never invent a layout from a guess.

## Tokens and components only

Colour comes only from the `@theme` tokens in `app/app.css` — the `--color-*` block is the list. Green is the one accent; red exists only as the strike on a "before" and the rule on an open incident (DESIGN.md rule 8). Components come from the map in DESIGN.md §11: the app-level components in `app/components/` composing the shadcn primitives in `app/components/ui/`, nothing hand-rolled. A component the map does not cover is Fable's call, recorded in the PR, not a silent divergence.

## No nearby keyframe: pull Mobbin references

A screen with no nearby keyframe (settings subpages, empty and error states, auth, email) does not start from a guess. Pull 3+ Mobbin references and 1 anti-reference yourself through the `mcp` tool (server `mobbin`), and cite each `mobbin_url` in the PR. A reference names the ingredient you kept; an anti-reference names a pattern you rejected and why not. Take ingredients only, never a layout. The format is the "Copy references (Mobbin, pulled by Fable)" section of `docs/design-directions/a-final/README.md`. If the Mobbin call fails, park the issue `blocked-on: orchestrator` + `needs-orchestrator` and stop — never guess a screen.

## Screenshot before the PR

Screenshot the screen at 1440×900 and 390×844 with chrome-devtools before opening a PR and attach both shots, named `<screen>-desktop-1440.png` and `<screen>-mobile-390.png`. The Layout section of the verify skill (`.agents/skills/verify/SKILL.md`) has the commands.
