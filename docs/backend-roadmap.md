# Honeycomb Backend Roadmap

This document tracks what the Honeycomb backend can do now, what is only partial,
and what still needs to be implemented. Keep it updated when backend capability
changes land.

## Current Backend Status

### Done Enough For Product Integration

1. Jobs and sessions
   - HTTP job ingress via `POST /jobs`.
   - Feishu webhook ingress skeleton via `POST /webhooks/feishu/events`.
   - Job list, details, timeline, messages, cancellation, archive, restore, fork,
     and compression APIs.

2. Runtime observability
   - Runtime logs and usage summary.
   - Session events list.
   - Session events SSE stream for live UI updates.

3. Plans and Todo
   - Job plan creation.
   - Plan listing, reading, patching.
   - Plan item creation and patching.

4. Experience memory
   - Routing outcome candidates.
   - Adopt/reject flow.
   - Repair script for cancelled archive cleanup.

5. Workspace read APIs
   - Workspace inspect.
   - File tree listing.
   - File read with binary detection and size limits.
   - Git status.

6. Human approval ledger
   - Tool approval request table.
   - Pending/approved/rejected/cancelled/consumed/expired state machine.
   - Approval events are written into the session event stream.

7. Approval-gated local tools
   - Workspace file write: protected by approval target matching.
   - Workspace command run: protected by approval command and cwd matching,
     `shell: false`, timeout, and output limits.

8. Packaging/layout checks
   - Package layout audit script.
   - No-secret scan.
   - Desktop launcher and shortcut repair path.

## Partial Or Not Yet Real Enough

1. OpenClaw real-agent orchestration
   - Current worker can run the platform workflow shape.
   - Real OpenClaw/ClawPanel agent provisioning is not yet a first-class backend
     API.
   - The backend still needs to create, update, validate, and launch the
     required agent set from Honeycomb instead of relying on manual setup.

2. Model/provider configuration center
   - First-run UI can collect model and API key.
   - Backend does not yet own a durable provider registry for panel-agent and
     child-agent model routing.
   - API key storage and retrieval must stay local and should not leak into
     generated prompt files or public logs.

3. Agent registry
   - Product concept needs panel supervisor, research, writer, image, video,
     test/reviewer and future specialist agents.
   - Backend does not yet expose CRUD/status/config APIs for these agents.
   - Agent config needs model, key configured flag, workspace, prompt template,
     tool permissions, and OpenClaw sync state.

4. Skills and MCP registry
   - UI has copy and placeholders.
   - Backend does not yet persist skills, MCP servers, enabled/disabled state,
     diagnostics, or per-agent access policy.

5. Web/MCP/network tool gateway
   - File writes and command runs are approval-gated.
   - MCP calls, web fetch/search, browser automation, and external network calls
     still need the same approval, audit, timeout, and output limit pattern.

6. Scheduled tasks
   - No durable schedule table yet.
   - Missing one-time, daily, interval, manual-trigger, wake-on-startup, and
     selected model/workspace execution policies.

7. Mobile and IM background agent
   - Feishu webhook exists as ingress.
   - Lark/WeChat/IM relay, phone connection setup, and background agent session
     management are not complete.

8. Desktop approval UI
   - Backend supports approvals and approved tool execution.
   - Desktop still needs an approval queue, modal, risk text, reject/approve
     controls, and SSE refresh integration.

9. Installer and runtime diagnostics
   - Windows local launcher is repaired.
   - Full installer readiness, OpenClaw dependency discovery, Docker/WSL checks,
     provider diagnostics, and repair actions need a dedicated backend diagnostic
     surface.

## Work Order

### Phase A: Make Product State Inspectable

1. Add `/runtime/capabilities`.
   - Return backend capability status, routes, risks, and next actions.
   - Purpose: settings/diagnostics page can show what is real and what is still
     planned.

2. Add OpenClaw runtime discovery.
   - Locate configured OpenClaw runtime.
   - Report installed/missing/unknown status.
   - Report known config paths without printing secrets.

### Phase B: Make First-Run Setup Actually Provision The System

3. Add provider registry.
   - Store provider name, base URL template, model, key configured flag, and
     verification status.
   - Keep API keys local-only and redacted.

4. Add agent registry.
   - Store panel supervisor and child agents.
   - Use the user-provided panel-agent name for the main/panel agent.
   - Add missing `video-agent`.
   - Track whether each agent is synced to OpenClaw.

5. Add OpenClaw sync API.
   - Generate or update agent prompt files.
   - Generate or update model/provider config.
   - Validate that OpenClaw can see the agents.

### Phase C: Make Tooling Useful And Safe

6. Add desktop approval UI.
   - Queue, detail, approve/reject/cancel.
   - Risk level text.
   - Live SSE updates.

7. Add Skills/MCP registry.
   - CRUD skills and MCP servers.
   - Diagnostics and enable/disable switches.
   - Per-agent policy.

8. Add approval-gated Web/MCP calls.
   - Same approval ledger as file/command.
   - Timeout/output caps.
   - Event stream visibility.

### Phase D: Make It Operable Like A Product

9. Add scheduled tasks.
   - One-time, daily, interval, manual tasks.
   - Bind workspace, model, and reasoning/execution settings.

10. Add IM/mobile background agent.
    - Feishu/Lark/WeChat/relay setup.
    - Independent background sessions.

11. Add installer/runtime diagnostics.
    - OpenClaw, WSL/Docker, database, API, worker, desktop bundle, and provider
      checks.
    - Safe repair actions.

## Current Next Step

Implement Phase A.1: `/runtime/capabilities`, then use it as the source of truth
for the backend status panel.
