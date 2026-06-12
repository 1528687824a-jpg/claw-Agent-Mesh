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
   - Registered workspace root list and approval-gated registration.
   - Workspace inspect.
   - File tree listing.
   - File read with binary detection and size limits.
   - Git status.
   - Workspace reads/writes/commands/git status now require a registered root.

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
   - Approval-gated MCP stdio `tools/list` and `resources/list` discovery with
     results cached into MCP server config for UI use.
   - Per-agent MCP access policy API and enforcement for tools/list,
     resources/list, and tools/call.

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

13. Local API security baseline
   - All non-health API routes require a Honeycomb bearer token.
   - Desktop launcher generates a per-machine random token under the local app
     data directory and passes it to Docker/API and the UI.
   - Desktop API calls send `Authorization: Bearer <token>`.
   - SSE uses the same local token via `access_token` query because browser
     `EventSource` cannot set custom headers.
   - Docker API and Postgres ports are published only on `127.0.0.1`.
   - Source/dev and Docker smoke tests assert that unauthenticated business API
     requests are rejected.
   - Workspace filesystem APIs require a registered root. First registration is
     approval-gated through `workspace.register`.
   - Provider and agent API keys are stored outside JSON config through a local
     secret boundary; Windows uses DPAPI and legacy plaintext files are migrated
     on read.
   - Tool approvals now receive a default expiry, approved requests expire
     before consumption, and API approval decisions record the desktop approval
     boundary instead of trusting the client-provided decider.
   - Web fetch resolves and pins the connect IP for each request/redirect while
     keeping Host/SNI on the original hostname, closing the DNS rebinding
     check/connect gap.

14. Backend source hygiene
   - Worker no longer imports source files from the orchestrator API app.
   - Shared local secret handling now lives in `packages/runtime`.
   - DBOS workflow launch helpers live with the worker runtime.
   - A first `node:test` unit test entry covers web fetch URL normalization,
     private-network blocking, and approved private fetch behavior.

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
   - Approval-gated stdio MCP `tools/list` and `resources/list` discovery
     exists and stores the latest discovery result in server config.
   - Per-agent MCP access policies can allow tools/list, resources/list, all
     tools, or a specific tool allow-list.
   - Long-lived MCP sessions are still missing.

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

10. Security hardening from `HONEYC~2.MD`
   - S1 API bearer token and local-only Docker/Postgres port publishing are
     implemented.
   - S2 registered workspace root whitelist and approval-gated first
     registration are implemented.
   - S4 Windows DPAPI encryption for saved provider/agent API keys is
     implemented; macOS/Linux keychain support remains a cross-platform release
     item.
   - S5 default approval expiry, approved-before-consume expiry checks, and a
     tighter desktop decision actor boundary are implemented.
   - S6 web fetch hostname/IP pinning is implemented for initial requests and
     redirects.
   - Worker-to-API reverse imports for runtime/secret helpers are removed.
   - Unit test coverage has started with web fetch safety behavior; the large
     API and desktop modules still need further extraction into tested units.

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

6. Security baseline before broader tool exposure.
   - Enforce local API auth and avoid LAN-exposed development services.
   - Status: done for the current Windows-local baseline. Non-health API routes now require a bearer token,
     desktop/dev launchers generate and inject that token, and Docker API /
     Postgres ports bind to `127.0.0.1`; registered workspace roots and
     approval-gated workspace registration now exist. Provider/agent API keys
     use DPAPI on Windows, approval expiry is enforced before decisions and
     consumption, and web fetch pins the resolved connect IP. Cross-platform
     keychain support is still needed before macOS/Linux release builds.

7. Add desktop approval UI.
   - Queue, detail, approve/reject/cancel.
   - Risk level text.
   - Live SSE updates.
   - Status: partial done. Pending queue, detail cards, and approve/reject
     controls exist; SSE refresh and policy editing are still missing.

8. Add Skills/MCP registry.
   - CRUD skills and MCP servers.
   - Diagnostics and enable/disable switches.
   - Per-agent policy.
   - Status: partial done. Registry, command diagnostics, approval-gated stdio
     calls/discovery, and per-agent policy enforcement exist; long-lived MCP
     sessions are still missing.

9. Add approval-gated Web/MCP calls.
   - Same approval ledger as file/command.
   - Timeout/output caps.
   - Event stream visibility.
   - Status: partial done. Web fetch and minimal MCP stdio tools/list,
     resources/list, and tools/call are approval-gated and audited; web search,
     browser automation, and long-lived MCP sessions are still missing.

### Phase D: Make It Operable Like A Product

10. Add scheduled tasks.
   - One-time, daily, interval, manual tasks.
   - Bind workspace, model, and reasoning/execution settings.
   - Status: partial done. Schedule CRUD, due listing, next-run calculation,
     manual trigger-to-job, worker runner, and startup catch-up exist; product
     UI and model/reasoning policy binding are still missing.

11. Add IM/mobile background agent.
    - Feishu/Lark/WeChat/relay setup.
    - Independent background sessions.

12. Add installer/runtime diagnostics.
    - OpenClaw, WSL/Docker, database, API, worker, desktop bundle, and provider
      checks.
    - Safe repair actions.
    - Status: partial done. Runtime diagnostics aggregate exists; repair actions
      and deeper installer checks still need implementation.

## Current Next Step

The `HONEYC~2.MD` P0 Windows-local security hardening is now closed for S1,
S2, S4, S5, and S6. Next, implement approval-gated search/browser calls, MCP
session reuse, schedule configuration UI, packaged OpenClaw launch/restart
integration, and the server/module test split called out by the review. The
backend approval ledger, approval-gated local tools, approval-gated web fetch,
approval-gated MCP tools/list/resources/list/tools/call, desktop approval queue,
provider registry, agent registry, worker provider/agent routing, OpenClaw
prompt/config sync, Skills/MCP registry foundation, per-agent MCP policy,
scheduled task runner, and diagnostics surface now exist; the next highest-value
slices are extending the same approval pattern to search/browser tools, proving
a real OpenClaw provider end-to-end, and separating the large API/desktop files
into tested modules.
