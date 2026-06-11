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
   - Runtime diagnostics aggregate through `GET /runtime/diagnostics`.

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
   - Desktop pending approval queue can approve or reject requests.

7. Approval-gated local tools
   - Workspace file write: protected by approval target matching.
   - Workspace command run: protected by approval command and cwd matching,
     `shell: false`, timeout, and output limits.

8. Skills/MCP registry foundation
   - Skill registry CRUD API.
   - MCP server registry CRUD API.
   - Enable/disable state.
   - MCP command availability diagnostics.
   - Approval-gated MCP stdio `tools/call` proxy with timeout/output caps and
     audit events.

9. Scheduled task foundation
   - Schedule table and CRUD API.
   - One-time, daily, interval, and manual schedule metadata.
   - Due-task listing.
   - Manual trigger creates a real job.
   - Worker scheduler runner claims due tasks and catches up overdue tasks on
     worker startup.

10. Packaging/layout checks
   - Package layout audit script.
   - No-secret scan.
   - Desktop launcher and shortcut repair path.

11. Worker model/agent routing foundation
   - Worker resolves `main-agent`/panel aliases through the backend agent
     registry.
   - The panel-agent maps to OpenClaw `main-agent`; Honeycomb no longer needs a
     duplicate `main-agent` registry entry.
   - Worker reads provider/model/key configuration and passes redacted routing
     metadata into job events.
   - Docker API and worker containers share a local-only provider secret volume.

12. OpenClaw native runtime config writer
   - `/openclaw/sync/apply` writes `cluster.config.json`,
     `agent-model-configs.json`, `openclaw.env`, and `runtime-manifest.json`
     into the selected runtime.
   - Generated provider config records API key configured/fingerprint status but
     never writes plaintext API keys.
   - Docker API and worker containers now discover `/app/honeycomb-runtime` and
     the launcher-provided runtime config paths.
   - Runtime control API exposes status/start/restart/stop hooks when explicit
     host commands are configured.

## Partial Or Not Yet Real Enough

1. OpenClaw real-agent orchestration
   - Current worker can run the platform workflow shape.
   - Runtime discovery is now available through `GET /openclaw/runtime`.
   - Sync plan/apply/validate APIs now write Honeycomb prompt/config files into
     the selected runtime.
   - Sync apply now also writes native runtime files: `cluster.config.json`,
     `agent-model-configs.json`, `openclaw.env`, and `runtime-manifest.json`.
   - Runtime control now has configurable status/start/restart/stop command
     endpoints.
   - Worker execution now resolves Honeycomb agents to OpenClaw agent IDs and
     supplies provider/model/key runtime environment variables for real CLI
     calls.
   - Packaged default OpenClaw launch/restart command wiring and real OpenClaw
     end-to-end regression are still not complete.

2. Model/provider configuration center
   - First-run UI can collect model and API key.
   - Backend provider registry now exists through `/providers`.
   - API keys are saved through a local-only secret boundary; responses only
     expose configured/fingerprint status.
   - Worker routing consumes provider base URL, model, and API key from this
     registry.
   - Native generated OpenClaw provider config now writes redacted model/provider
     records for each agent; plaintext keys still stay in the local secret
     boundary.
   - Real provider end-to-end regression against installed OpenClaw is still
     pending.

3. Agent registry
   - Product concept needs panel supervisor, research, writer, image, video,
     test/reviewer and future specialist agents.
   - Backend agent registry now exists through `/agents`.
   - Default seed creates panel-agent, research-agent, writer-agent, image-agent,
     video-agent, and test-agent.
   - The panel-agent maps to OpenClaw `main-agent` without duplicating a
     Honeycomb main-agent entry.
   - OpenClaw prompt/config sync and validation exist.
   - Worker maps panel/main aliases through the registry before calling
     OpenClaw.
   - Native OpenClaw config writing exists; packaged launch/restart validation
     after sync is still missing.

4. Skills and MCP registry
   - Backend persists skills and MCP servers through `/skills` and
     `/mcp-servers`.
   - MCP command availability can be checked.
   - Minimal approval-gated stdio MCP `tools/call` execution exists.
   - Long-lived MCP sessions, tools/list, resource APIs, and per-agent access
     policy enforcement are still missing.

5. Web/MCP/network tool gateway
   - File writes and command runs are approval-gated.
   - Approval-gated web fetch now supports HTTP/HTTPS GET with approval target
     matching, timeout/output caps, redirect revalidation, private-network
     blocking by default, and audit events.
   - MCP calls, web search, browser automation, and broader external network
     calls still need the same safe gateway pattern.

6. Scheduled tasks
   - Durable schedule table and CRUD API exist.
   - Manual trigger can create a real job.
   - Worker scheduler runner and startup catch-up exist.
   - Selected model/workspace execution policies are still incomplete.

7. Mobile and IM background agent
   - Feishu webhook exists as ingress.
   - Lark/WeChat/IM relay, phone connection setup, and background agent session
     management are not complete.

8. Desktop approval UI
   - Backend supports approvals and approved tool execution.
   - Desktop pending approval queue, risk text, detail view, and reject/approve
     controls exist.
   - SSE refresh and policy editing are still incomplete.

9. Installer and runtime diagnostics
   - Windows local launcher is repaired.
   - Runtime diagnostics aggregate exists.
   - Full installer readiness, Docker/WSL checks, and repair actions still need
     deeper backend diagnostics.

## Work Order

### Phase A: Make Product State Inspectable

1. Add `/runtime/capabilities`.
   - Return backend capability status, routes, risks, and next actions.
   - Purpose: settings/diagnostics page can show what is real and what is still
     planned.
   - Status: done.

2. Add OpenClaw runtime discovery.
   - Locate configured OpenClaw runtime.
   - Report installed/missing/unknown status.
   - Report known config paths without printing secrets.
   - Status: done.

### Phase B: Make First-Run Setup Actually Provision The System

3. Add provider registry.
   - Store provider name, base URL template, model, key configured flag, and
     verification status.
   - Keep API keys local-only and redacted.
   - Status: partial done. Registry, local-only key status, verification, shared
     Docker secret volume, and worker routing now exist; native OpenClaw
     provider config writing is still missing.

4. Add agent registry.
   - Store panel supervisor and child agents.
   - Use the user-provided panel-agent name for the main/panel agent.
   - Add missing `video-agent`.
   - Track whether each agent is synced to OpenClaw.
   - Status: partial done. Registry, default catalog, OpenClaw prompt/config
     sync, and worker runtime resolution exist; OpenClaw launch/restart
     validation is still missing.

5. Add OpenClaw sync API.
   - Generate or update agent prompt files.
   - Generate or update model/provider config.
   - Validate that OpenClaw can see the agents.
   - Status: partial done. The backend can plan/apply/validate Honeycomb prompt
     files, generated config, native runtime config, redacted model/provider
     config, env file, and runtime manifest. It still needs packaged default
     launch/restart command wiring and real OpenClaw E2E validation.

### Phase C: Make Tooling Useful And Safe

6. Add desktop approval UI.
   - Queue, detail, approve/reject/cancel.
   - Risk level text.
   - Live SSE updates.
   - Status: partial done. Pending queue, detail cards, and approve/reject
     controls exist; SSE refresh and policy editing are still missing.

7. Add Skills/MCP registry.
   - CRUD skills and MCP servers.
   - Diagnostics and enable/disable switches.
   - Per-agent policy.
   - Status: partial done. Registry and command diagnostics exist; real MCP call
     execution and per-agent policy enforcement are still missing.

8. Add approval-gated Web/MCP calls.
   - Same approval ledger as file/command.
   - Timeout/output caps.
   - Event stream visibility.
   - Status: partial done. Web fetch and minimal MCP stdio tools/call are
     approval-gated and audited; web search, browser automation, long-lived MCP
     sessions, tools/list, resources, and per-agent access policy are still
     missing.

### Phase D: Make It Operable Like A Product

9. Add scheduled tasks.
   - One-time, daily, interval, manual tasks.
   - Bind workspace, model, and reasoning/execution settings.
   - Status: partial done. Schedule CRUD, due listing, next-run calculation,
     manual trigger-to-job, worker runner, and startup catch-up exist; product
     UI and model/reasoning policy binding are still missing.

10. Add IM/mobile background agent.
    - Feishu/Lark/WeChat/relay setup.
    - Independent background sessions.

11. Add installer/runtime diagnostics.
    - OpenClaw, WSL/Docker, database, API, worker, desktop bundle, and provider
      checks.
    - Safe repair actions.
    - Status: partial done. Runtime diagnostics aggregate exists; repair actions
      and deeper installer checks still need implementation.

## Current Next Step

Implement approval-gated search/browser calls, MCP session reuse/tools-list,
schedule configuration UI, and packaged OpenClaw launch/restart integration. The
backend approval ledger, approval-gated local tools, approval-gated web fetch,
approval-gated MCP tools/call, desktop approval queue, provider registry, agent
registry, worker provider/agent routing, OpenClaw prompt/config sync, Skills/MCP
registry foundation, scheduled task runner, and diagnostics surface now exist;
the next highest-value slices are extending the same approval pattern to
search/browser tools and proving a real OpenClaw provider end-to-end.
