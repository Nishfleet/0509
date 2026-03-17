# 0509.in — Competitor Ad Research

## Build
```bash
npm run build
```

## Lint
```bash
npm run lint
```

## Dev
```bash
npm run dev
```

## Stack
- Next.js 16.1.6, React 19, TypeScript 5
- Pure CSS (globals.css, no Tailwind)
- Vercel deployment
- No backend — frontend-only demo + marketing

## Architecture
- `src/app/` — Next.js app router pages
- `src/components/` — React components
- `src/lib/` — Config, demo data, utilities
- Routes: `/` (homepage), `/search` (demo), `/waitlist` (fallback)

## Conventions
- CSS classes in `globals.css`, no CSS modules
- `@/*` path alias maps to `./src/*`
- Waitlist URL configured via `NEXT_PUBLIC_WAITLIST_URL` env var
- Keep it fast, clean, frontend-first
- All components are server components unless explicitly "use client"

## Design Language
- Clean, minimal, professional SaaS aesthetic
- Brand color: deep navy/indigo
- Typography: system font stack with Google Font overrides in layout.tsx
- Cards, pills, eyebrow text patterns throughout
