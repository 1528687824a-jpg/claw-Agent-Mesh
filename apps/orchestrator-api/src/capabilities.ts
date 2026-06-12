export type RuntimeCapabilityStatus = "ready" | "partial" | "planned";

export type RuntimeCapability = {
  id: string;
  title: string;
  status: RuntimeCapabilityStatus;
  summary: string;
  routes: string[];
  implemented: string[];
  missing: string[];
  nextActions: string[];
};

export type RuntimeCapabilitiesResponse = {
  generatedAt: string;
  summary: {
    ready: number;
    partial: number;
    planned: number;
    total: number;
  };
  capabilities: RuntimeCapability[];
  recommendedNext: string[];
};

const capabilities: RuntimeCapability[] = [
  {
    id: "jobs_sessions",
    title: "Jobs and sessions",
    status: "ready",
    summary: "Task intake, session lifecycle, timelines, cancellation, archive, restore, fork, and compression are available.",
    routes: [
      "POST /jobs",
      "GET /jobs",
      "GET /jobs/:jobId",
      "GET /jobs/:jobId/timeline",
      "POST /jobs/:jobId/cancel",
      "GET /sessions",
      "POST /sessions/:sessionId/archive",
      "POST /sessions/:sessionId/restore",
      "POST /sessions/:sessionId/fork",
      "POST /sessions/:sessionId/compress"
    ],
    implemented: [
      "HTTP job ingress",
      "Feishu webhook ingress skeleton",
      "DBOS workflow launch path",
      "Session archive/restore/fork/compress"
    ],
    missing: [
      "Full product-facing task composer UI is still separate from this backend surface"
    ],
    nextActions: [
      "Keep adding live UI consumers on top of the existing routes"
    ]
  },
  {
    id: "runtime_observability",
    title: "Runtime observability",
    status: "ready",
    summary: "Runtime logs, token/cost usage summary, session event history, and SSE streaming are available.",
    routes: [
      "GET /runtime/logs",
      "GET /runtime/usage",
      "GET /sessions/:sessionId/events",
      "GET /sessions/:sessionId/events/stream",
      "GET /runtime/capabilities",
      "GET /runtime/diagnostics"
    ],
    implemented: [
      "Runtime log queries",
      "Token usage summary from real-mode OpenClaw usage payloads",
      "Estimated USD cost from provider metadata pricing",
      "Per-provider/model, per-agent, and per-day usage/cost buckets",
      "Session event stream",
      "Machine-readable capability inventory",
      "Runtime diagnostics aggregate"
    ],
    missing: [
      "Desktop diagnostics page still needs to render every diagnostic check"
    ],
    nextActions: [
      "Render runtime capabilities in settings or diagnostics UI"
    ]
  },
  {
    id: "local_api_security",
    title: "Local API security baseline",
    status: "ready",
    summary: "Non-health routes require a local Honeycomb bearer token, workspace roots are registered through approval, Windows API keys use DPAPI, approvals expire, and web fetch pins DNS targets.",
    routes: [
      "GET /health",
      "all non-health API routes"
    ],
    implemented: [
      "Bearer-token middleware for non-health API routes",
      "Authorization, x-honeycomb-token, and SSE access_token support",
      "Desktop launcher generates a per-machine local token",
      "Desktop API client injects the token automatically",
      "Docker API port binds to 127.0.0.1:3000",
      "Docker Postgres port binds to 127.0.0.1:5432",
      "Source and Docker smoke tests assert missing-token rejection",
      "Workspace APIs require a registered root",
      "First workspace registration is approval-gated",
      "Windows provider and agent API keys are stored through DPAPI-backed local secret files",
      "Legacy plaintext provider/agent key files migrate on read",
      "Tool approvals get default expiry and approved approvals expire before consumption",
      "API approval decisions record the desktop approval actor instead of trusting client-provided decidedBy",
      "Web fetch resolves and pins the connect IP for every request and redirect"
    ],
    missing: [
      "macOS/Linux keychain integration before cross-platform release",
      "Signed/attested desktop identity for multi-user or remote approval scenarios"
    ],
    nextActions: [
      "Keep the same approval and network gateway pattern for search/browser tools"
    ]
  },
  {
    id: "plans_todos",
    title: "Plans and Todo",
    status: "ready",
    summary: "Plans and editable plan items can be created, listed, read, and updated.",
    routes: [
      "GET /plans",
      "GET /plans/:planId",
      "PATCH /plans/:planId",
      "POST /jobs/:jobId/plan",
      "POST /plans/:planId/items",
      "PATCH /plans/:planId/items/:itemId"
    ],
    implemented: [
      "Plan records",
      "Plan item records",
      "Plan status and item status updates"
    ],
    missing: [
      "Desktop side panel synchronization is not fully wired to every task view"
    ],
    nextActions: [
      "Connect task UI Todo state to plan item APIs and SSE"
    ]
  },
  {
    id: "experience_memory",
    title: "Experience memory",
    status: "ready",
    summary: "Routing outcome memories can be collected and adopted or rejected.",
    routes: [
      "GET /memory/experiences",
      "POST /memory/experiences/:experienceId/adopt",
      "POST /memory/experiences/:experienceId/reject"
    ],
    implemented: [
      "Experience candidates",
      "Adopt/reject state",
      "Runtime usage integration"
    ],
    missing: [
      "Broader cross-session user preference memory is not complete"
    ],
    nextActions: [
      "Add explicit preference/profile memory after provider and agent registries exist"
    ]
  },
  {
    id: "workspace_tools",
    title: "Workspace tools",
    status: "ready",
    summary: "Workspace inspect, list, read, git status, approval-gated file write, and approval-gated command run are implemented.",
    routes: [
      "GET /workspaces",
      "POST /workspaces/register",
      "GET /workspaces/inspect",
      "GET /workspaces/files",
      "GET /workspaces/file",
      "POST /workspaces/file/write",
      "POST /workspaces/command/run",
      "GET /workspaces/git/status"
    ],
    implemented: [
      "Registered workspace root whitelist",
      "Approval-gated workspace registration",
      "Path traversal protection",
      "File read limits",
      "Approval-gated file writes",
      "Approval-gated command execution with shell disabled",
      "Command timeout and output limits"
    ],
    missing: [
      "Open-in-editor API",
      "Diff collection and review panel data"
    ],
    nextActions: [
      "Add open-in-editor and diff capture after desktop approval UI is present"
    ]
  },
  {
    id: "tool_approvals",
    title: "Human approval ledger",
    status: "ready",
    summary: "Tool approval requests and decision/consume state transitions are implemented and auditable.",
    routes: [
      "GET /approvals",
      "POST /approvals",
      "GET /approvals/:approvalId",
      "POST /approvals/:approvalId/approve",
      "POST /approvals/:approvalId/reject",
      "POST /approvals/:approvalId/cancel",
      "POST /approvals/:approvalId/consume"
    ],
    implemented: [
      "Approval table",
      "Risk levels",
      "Pending/approved/rejected/cancelled/consumed/expired states",
      "Session event emission",
      "Desktop pending approval queue with approve/reject controls"
    ],
    missing: [
      "Per-tool approval policy registry"
    ],
    nextActions: [
      "Add policy defaults per tool and approval coverage for MCP/browser/search calls"
    ]
  },
  {
    id: "openclaw_sync",
    title: "OpenClaw real-agent sync",
    status: "partial",
    summary: "Runtime discovery, sync plan/apply/validate APIs, native Honeycomb/OpenClaw config writing, workflow shape, templates, and worker agent routing exist; real launch/restart command wiring is still deployment-dependent.",
    routes: [
      "GET /openclaw/runtime",
      "GET /openclaw/runtime/control",
      "POST /openclaw/runtime/:action",
      "POST /openclaw/sync/plan",
      "POST /openclaw/sync/apply",
      "POST /openclaw/sync/validate"
    ],
    implemented: [
      "OpenClaw runtime discovery",
      "OpenClaw sync plan API",
      "OpenClaw prompt/config apply API",
      "OpenClaw agent presence validation API",
      "Agent prompt templates",
      "Example OpenClaw multi-agent config",
      "Native cluster.config.json writer",
      "Native agent-model-configs.json writer with redacted API key status",
      "OpenClaw runtime manifest and env file writer",
      "Configurable OpenClaw status/start/restart/stop command API",
      "Worker workflow shape",
      "Worker resolves Honeycomb agents to OpenClaw agent IDs before real CLI calls",
      "OpenClaw real smoke scripts"
    ],
    missing: [
      "Host-provided OpenClaw launch/restart command defaults for packaged desktop runtime",
      "Real-agent workflow replacement for remaining mock activities"
    ],
    nextActions: [
      "Add packaged desktop defaults for OpenClaw launch/restart commands"
    ]
  },
  {
    id: "provider_registry",
    title: "Model/provider configuration center",
    status: "partial",
    summary: "Backend provider registry, local-only key status, OpenAI-compatible verification with latency metadata, shared Docker secret volume, and worker provider routing/failover are available.",
    routes: [
      "GET /providers",
      "POST /providers",
      "PATCH /providers/:providerId",
      "POST /providers/verify-batch",
      "POST /providers/:providerId/verify"
    ],
    implemented: [
      "First-run provider collection UI",
      "Real-provider smoke documentation and scripts",
      "Durable provider registry",
      "Local-only provider key storage boundary",
      "Redacted key configured/fingerprint status",
      "OpenAI-compatible provider verification endpoint",
      "Batch provider verification endpoint with latency recorded in provider metadata",
      "API and worker share provider secrets through a Docker secret volume",
      "Worker passes provider base URL, model, and API key to real OpenClaw CLI calls as runtime env",
      "Worker can try fallback provider/model routes from agent/provider metadata before failing a model call",
      "OpenClaw agent-model config is generated without writing plaintext API keys"
    ],
    missing: [
      "Real provider end-to-end regression against installed OpenClaw"
    ],
    nextActions: [
      "Run real provider end-to-end regression against installed OpenClaw"
    ]
  },
  {
    id: "agent_registry",
    title: "Agent registry",
    status: "partial",
    summary: "Backend agent registry, default Honeycomb catalog, OpenClaw sync status tracking, and worker runtime resolution exist.",
    routes: [
      "GET /agents",
      "POST /agents",
      "PATCH /agents/:agentId",
      "POST /agents/seed-defaults"
    ],
    implemented: [
      "Prompt templates",
      "Front-end agent configuration panels",
      "Agent config table",
      "Agent config CRUD API",
      "Default panel/research/writer/image/video/test catalog",
      "Panel agent maps to OpenClaw main-agent without duplicate Honeycomb main-agent",
      "OpenClaw sync status per agent",
      "Worker maps main-agent/panel aliases to panel-agent and then to the configured OpenClaw agent ID"
    ],
    missing: [
      "Native OpenClaw launch/restart validation after agent sync"
    ],
    nextActions: [
      "Validate real worker execution after OpenClaw provider config writing lands"
    ]
  },
  {
    id: "skills_mcp",
    title: "Skills and MCP registry",
    status: "partial",
    summary: "Skills and MCP servers can be persisted, toggled, command-checked, listed, resource-listed, and called through minimal approval-gated stdio MCP proxies.",
    routes: [
      "GET /skills",
      "POST /skills",
      "PATCH /skills/:skillId",
      "GET /mcp-servers",
      "POST /mcp-servers",
      "PATCH /mcp-servers/:serverId",
      "POST /mcp-servers/:serverId/check",
      "GET /mcp-policies",
      "POST /mcp-policies",
      "PATCH /mcp-policies/:policyId",
      "POST /mcp-servers/:serverId/tools/list",
      "POST /mcp-servers/:serverId/resources/list",
      "POST /mcp-servers/:serverId/tools/call"
    ],
    implemented: [
      "Skill registry table and CRUD API",
      "MCP server registry table and CRUD API",
      "Enable/disable state",
      "MCP command availability diagnostics",
      "Approval-gated MCP stdio initialize + tools/call proxy",
      "Approval-gated MCP tools/list and resources/list discovery",
      "MCP discovery results cached into server config for UI use",
      "Per-agent MCP access policies for tools/list, resources/list, and tools/call",
      "MCP timeout and output caps",
      "MCP call audit events",
      "Long-lived MCP stdio sessions with idle cleanup and config-change invalidation",
      "MCP session stats in runtime diagnostics"
    ],
    missing: [
      "MCP server notifications/streaming surfaced to the UI"
    ],
    nextActions: [
      "Extend the approval gateway to web search and browser automation"
    ]
  },
  {
    id: "web_network_tools",
    title: "Web/MCP/network tool gateway",
    status: "partial",
    summary: "Approval-gated web fetch is implemented with URL matching, timeout/output caps, DNS-pinned redirect checks, private-network blocking, and audit events; browser/search/MCP execution still needs safe gateways.",
    routes: [
      "POST /tools/web/fetch"
    ],
    implemented: [
      "Reusable approval ledger pattern",
      "Approval-gated HTTP/HTTPS GET",
      "Approval target and command matching",
      "Timeout and output caps",
      "Private-network target blocking unless explicitly allowed",
      "Redirect target revalidation with DNS-pinned connect IPs",
      "Network audit events"
    ],
    missing: [
      "Approval-gated web search",
      "Approval-gated browser automation",
      "Per-agent network access policy enforcement"
    ],
    nextActions: [
      "Implement web search/browser gateways with the same approval pattern"
    ]
  },
  {
    id: "schedules",
    title: "Scheduled tasks",
    status: "partial",
    summary: "One-time, daily, interval, and manual tasks can be persisted, manually triggered, and picked up by the worker scheduler; model/reasoning policy binding is still incomplete.",
    routes: [
      "GET /schedules",
      "GET /schedules/due",
      "GET /schedules/:scheduleId",
      "POST /schedules",
      "PATCH /schedules/:scheduleId",
      "POST /schedules/:scheduleId/trigger"
    ],
    implemented: [
      "Schedule table",
      "Schedule CRUD API",
      "Next-run calculation for once/daily/interval tasks",
      "Manual trigger path that creates a real job",
      "Worker scheduler runner",
      "Startup catch-up for overdue tasks",
      "Consecutive-failure tracking with automatic disable at a configurable threshold"
    ],
    missing: [
      "Workspace/model/reasoning configuration per schedule"
    ],
    nextActions: [
      "Bind schedule execution to provider/agent routing and product scheduling UI"
    ]
  },
  {
    id: "mobile_im",
    title: "Mobile and IM background agent",
    status: "partial",
    summary: "Feishu ingress exists; Lark/WeChat/IM relay and background mobile-agent mode are not complete.",
    routes: [
      "POST /webhooks/feishu/events"
    ],
    implemented: [
      "Feishu webhook challenge/event handling path",
      "Public Feishu ingress docs and smoke script"
    ],
    missing: [
      "Lark-specific setup UI",
      "WeChat/IM relay",
      "Background agent sessions independent from normal chat",
      "Mobile connection diagnostics"
    ],
    nextActions: [
      "Finish desktop core runtime first, then expand IM adapters"
    ]
  },
  {
    id: "source_hygiene",
    title: "Source hygiene and tests",
    status: "partial",
    summary: "Worker-to-API reverse imports are removed for runtime/secret helpers, review notes are in-repo, and unit tests now cover several security boundaries.",
    routes: [],
    implemented: [
      "Shared local secret helpers live in packages/runtime",
      "Local secret reads have an in-process TTL cache",
      "Recognized encrypted secret envelopes do not fall back to plaintext migration after decrypt failure",
      "Worker DBOS launch helpers live with the worker runtime",
      "Worker source no longer imports orchestrator-api/src",
      "node:test unit script exists",
      "Web fetch unit tests cover URL normalization, private blocking, and explicit private fetch",
      "Security policy unit tests cover approvals, API auth, workspace targets, MCP policy matching, and secret cache/corruption behavior",
      "CI runs unit tests and Docker quickstart uses the local API token model",
      "HONEYC review notes are tracked under docs/reviews"
    ],
    missing: [
      "server.ts route modules are still too large",
      "desktop main.tsx is still too large",
      "Broader unit coverage for provider registry and OpenClaw sync"
    ],
    nextActions: [
      "Split server routes by domain and add focused unit tests around each extracted module"
    ]
  },
  {
    id: "installer_diagnostics",
    title: "Installer and runtime diagnostics",
    status: "partial",
    summary: "Launcher, package checks, and runtime diagnostics aggregate exist; repair actions and installer validation are still incomplete.",
    routes: [
      "GET /runtime/diagnostics"
    ],
    implemented: [
      "Desktop launcher repair",
      "Package layout audit",
      "No-secret scan",
      "Windows local Tauri shell smoke",
      "Runtime diagnostics aggregate for database, capabilities, OpenClaw, providers, agents, approvals, Skills/MCP, and schedules"
    ],
    missing: [
      "WSL/Docker/database readiness checks",
      "Repair action API",
      "Cross-platform installer validation"
    ],
    nextActions: [
      "Add runtime diagnostics after OpenClaw discovery API"
    ]
  }
];

export function getRuntimeCapabilities(): RuntimeCapabilitiesResponse {
  const summary = capabilities.reduce(
    (acc, capability) => {
      acc[capability.status] += 1;
      acc.total += 1;
      return acc;
    },
    { ready: 0, partial: 0, planned: 0, total: 0 }
  );

  return {
    generatedAt: new Date().toISOString(),
    summary,
    capabilities,
    recommendedNext: [
      "Phase 19 (pulled forward): packaged OpenClaw launch/restart command defaults and real provider E2E regression",
      "Phase 18: approval-gated search/browser tool calls and per-agent network policy",
      "Phase 18.5: split the large API/desktop modules into smaller tested modules",
      "Phase 20: schedule configuration UI after the real OpenClaw loop is proven"
    ]
  };
}
