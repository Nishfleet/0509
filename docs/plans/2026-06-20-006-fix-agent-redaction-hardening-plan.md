---
title: "fix: Harden agent-facing redaction"
date: "2026-06-20"
branch: "codex/0509-agent-redaction-hardening"
status: "in_progress"
---

# fix: Harden agent-facing redaction

## Goal

Preserve and verify the agent-facing security hardening work already present in the worktree: shared secret-pattern detection, client-room display redaction, safer counter-move and memory MCP schemas, and public status copy that does not expose tenant-backed evidence.

## Scope

- Move reusable secret-like text detection into a shared helper.
- Reject or redact secret-like client-room names, labels, resource labels, and notes before agent/UI exposure.
- Require idempotency for counter-move brief creation across API/MCP paths.
- Keep Meta source retest responses credential-free through MCP.
- Keep public status as a coarse blocker/safety page rather than a tenant-backed evidence surface.
- Add focused tests for the bug classes above.

## Non-Goals

- No new customer-visible product claims.
- No schema migrations beyond existing client-room uniqueness behavior.
- No deploy or push in this cleanup pass.

## Verification

- Focused tests for client rooms, agent actions, dashboard, data persistence, MCP, and status.
- Typecheck, full tests, production build.
- Required final `autoreview` before merge to `main`.
