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
   - Token usage aggregation in `GET /runtime/usage`: totals, per-agent, and
     per-day prompt/completion/total tokens read from real-mode OpenClaw
     usage payloads.
   - Provider pricing metadata drives estimated USD cost in `GET /runtime/usage`:
     summary cost, per-provider/model cost, and per-agent/per-day cost buckets.
     Pricing is read from `provider.metadata.pricing`, including optional
     model-specific overrides.
   - Session events list.
   - Session events SSE stream for live UI updates.
   - Runtime diagnostics aggregate through `GET /runtime/diagnostics`,
     including open MCP session stats.

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
   - Long-lived MCP stdio sessions: the initialize handshake runs once per
     server, later calls reuse the same process, idle sessions are swept after
     a timeout (`HONEYCOMB_MCP_SESSION_IDLE_MS`), and config changes or
     enable/disable flips invalidate the old session. JSON-RPC error responses
     keep the session; timeout/output-cap/protocol failures drop it.
   - MCP session stats are visible through `GET /runtime/diagnostics`, and MCP
     audit events record session pid/request count/reuse.

9. Scheduled task foundation
   - Schedule table and CRUD API.
   - One-time, daily, interval, and manual schedule metadata.
   - Due-task listing.
   - Manual trigger creates a real job.
   - Worker scheduler runner claims due tasks and catches up overdue tasks on
     worker startup.
   - Consecutive trigger failures are counted in schedule metadata and the
     schedule auto-disables at a configurable threshold
     (`HONEYCOMB_SCHEDULE_MAX_CONSECUTIVE_FAILURES`, default 5); a successful
     trigger resets the counter.

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
   - Runtime control API exposes status/start/restart/stop hooks. Explicit host
     commands still take priority, and builtin packaged defaults prepare/mark
     the local OpenClaw runtime when host commands are absent.

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
   - Local provider secret reads have a process-local TTL cache, and recognized
     encrypted envelopes do not fall back to legacy plaintext migration if
     decryption fails.
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
   - `node:test` unit coverage now covers web fetch safety, approval expiry
     policy, API auth token parsing, workspace registration target
     normalization, MCP policy matching, secret cache/corruption behavior,
     MCP long-lived session lifecycle (reuse, crash recovery, idle sweep,
     timeout/output-cap destruction, config invalidation), and schedule
     failure policy.
   - HONEYC review notes are now tracked under `docs/reviews/`.
   - GitHub Actions runs `npm run test:unit`, and Docker quickstart CI uses the
     local API token model.

15. Process lifecycle hardening
   - The orchestrator API handles SIGINT/SIGTERM: it stops accepting
     connections, closes open SSE connections, shuts down long-lived MCP
     sessions, and closes the Postgres pool before exit (10s force-exit
     fallback).
   - The DBOS worker handles SIGINT/SIGTERM: it stops the scheduler runner,
     shuts down DBOS, and closes the Postgres pool before exit.
   - Admin token comparison now uses the same timing-safe equality helper as
     the API bearer token.

## Partial Or Not Yet Real Enough

1. OpenClaw real-agent orchestration
   - Current worker can run the platform workflow shape.
   - Runtime discovery is now available through `GET /openclaw/runtime`.
   - Sync plan/apply/validate APIs now write Honeycomb prompt/config files into
     the selected runtime.
   - Sync apply now also writes native runtime files: `cluster.config.json`,
     `agent-model-configs.json`, `openclaw.env`, and `runtime-manifest.json`.
   - Runtime control now has configurable status/start/restart/stop command
     endpoints plus builtin packaged defaults.
   - Worker execution now resolves Honeycomb agents to OpenClaw agent IDs and
     supplies provider/model/key runtime environment variables for real CLI
     calls.
   - Real OpenClaw end-to-end regression against an installed runtime is still
     not complete.

2. Model/provider configuration center
   - First-run UI can collect model and API key.
   - Backend provider registry now exists through `/providers`.
   - API keys are saved through a local-only secret boundary; responses only
     expose configured/fingerprint status.
   - Provider responses now reconcile database key flags with live local secret
     storage, so stale `apiKeyConfigured=true` records stop showing as
     configured after their secret file is missing or unreadable.
   - `/providers/verify-batch` verifies multiple OpenAI-compatible providers
     at once, records latency/status in `provider.metadata.verification`, and
     keeps pricing metadata intact.
   - Worker routing consumes provider base URL, model, and API key from this
     registry.
   - Worker route resolution supports fallback provider/model candidates from
     `agent.metadata.fallbackRoutes` / `fallbackProviderIds` and primary
     `provider.metadata` fallback declarations. Failed primary attempts are
     recorded in model-call routeAttempts before the worker tries the next
     route.
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
   - Long-lived MCP sessions with idle cleanup and config invalidation now
     exist; MCP server notifications/streaming are still not surfaced.

5. Web/MCP/network tool gateway
   - File writes and command runs are approval-gated.
   - Approval-gated web fetch now supports HTTP/HTTPS GET with approval target
     matching, timeout/output caps, redirect revalidation, private-network
     blocking by default, and audit events.
   - Approval-gated web search and browser snapshot now reuse the same network
     gateway pattern: exact approval target/command matching, DNS-pinned
     fetches, private-network blocking unless approved, approval consumption,
     and audit events.
   - Per-agent network policy can now allow or deny web fetch, web search, and
     browser snapshot by operation, private-network use, protocol, and host
     allow/block lists stored in agent metadata.
   - MCP calls now run through approval-gated long-lived sessions.
   - Full interactive browser automation and broader external network
     connectors still need safe product rules.

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
   - Runtime diagnostics now reconcile provider key status with live local
     secret storage and include a real-provider E2E readiness check that does
     not count localhost/example fake providers as live external providers.
   - Runtime repair API now exposes a repair action catalog and can reconcile
     provider secret state, prepare/restart the builtin OpenClaw runtime, seed
     default agents, apply OpenClaw sync, run idempotent database migrations,
     and re-check enabled MCP server commands.
   - Desktop supervisor workbench now includes a diagnostics repair card that
     lists backend repair actions and can execute them from the panel.
   - Full installer readiness and safe Docker/WSL repair actions still need
     deeper work.

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

11. Follow-up notes from `HONEYC~3.MD`
   - Review notes are now stored in `docs/reviews/`.
   - Local secret reads now have TTL caching and safer corrupted-envelope
     behavior.
   - Second unit-test batch and CI wiring are implemented.
   - Remote/iOS still needs short-lived SSE tickets or cookie auth, plus
     per-device token issuance/revocation.
   - OpenClaw real provider E2E should happen before Schedule UI investment.

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
   - Status: partial done. Registry, live local-only key status, verification,
     shared Docker secret volume, native redacted config writing, and worker
     routing now exist; real OpenClaw provider E2E validation is still missing.

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
     calls/discovery, per-agent policy enforcement, and long-lived MCP
     sessions with idle cleanup exist; MCP notifications/streaming are still
     missing.

9. Add approval-gated Web/MCP calls.
   - Same approval ledger as file/command.
   - Timeout/output caps.
   - Event stream visibility.
   - Status: partial done. Web fetch, web search, browser snapshot, and MCP
     stdio tools/list, resources/list, and tools/call are approval-gated,
     audited, and reuse the same safe gateway principles. Agent metadata can
     now enforce per-agent network policy for fetch/search/snapshot; richer
     interactive browser automation is still missing.

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
    - Status: partial done. Runtime diagnostics aggregate exists, provider
      secret-state reconciliation is included, and real-provider E2E readiness
      is explicit. First repair actions now exist for provider secret
      reconciliation, OpenClaw runtime control, default agent seeding, and
      OpenClaw sync apply. Database migration and MCP command re-check repair
      actions also exist. Desktop workbench can list and execute repair
      actions; deeper safe WSL/Docker repairs still need implementation.

## Current Next Step

Phase 17E MCP long-lived session reuse is now complete: MCP stdio calls share
one initialized process per server, idle sessions are swept, config changes
invalidate old sessions, and session stats are visible in diagnostics. Process
lifecycle hardening also landed: API and worker now shut down gracefully on
SIGINT/SIGTERM, and the scheduler auto-disables schedules after consecutive
failures. Packaged OpenClaw runtime control defaults now prepare/mark the local
runtime when host commands are absent. Phase 18 now has approval-gated web
search and browser snapshot calls; next, prove the real OpenClaw provider
end-to-end against an installed runtime, then finish Phase 18 richer interactive
browser automation, then Phase 18.5
architecture cleanup splitting `server.ts` and desktop `main.tsx` into tested
modules, and Schedule UI only after the real OpenClaw loop is proven. Two
Phase 19 real-mode risks are already closed: OpenClaw output extraction now
recognizes explicit shapes and fails loudly on empty/unrecognized output
(`extractOpenClawText` + `OpenClawOutputError`), and the WSL invocation wraps
the CLI in a Linux-side `timeout --kill-after` so a Windows-side kill cannot
leave orphan processes inside the distro. Remaining Phase 19 work: the real
provider E2E regression itself. Desktop fix landed alongside: DPAPI PowerShell calls no longer flash
console windows (CREATE_NO_WINDOW), decrypted reads are TTL-cached in-process,
and the secret-reading Tauri commands are async so they stop blocking the UI
thread.
