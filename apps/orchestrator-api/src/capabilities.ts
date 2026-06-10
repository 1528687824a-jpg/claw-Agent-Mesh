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
    summary: "Runtime logs, usage summary, session event history, and SSE streaming are available.",
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
      "Usage summary",
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
      "GET /workspaces/inspect",
      "GET /workspaces/files",
      "GET /workspaces/file",
      "POST /workspaces/file/write",
      "POST /workspaces/command/run",
      "GET /workspaces/git/status"
    ],
    implemented: [
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
      "Add policy defaults per tool and approval coverage for MCP/Web calls"
    ]
  },
  {
    id: "openclaw_sync",
    title: "OpenClaw real-agent sync",
    status: "partial",
    summary: "Runtime discovery, sync plan/apply/validate APIs, workflow shape, and templates exist; native OpenClaw launch/config integration is still partial.",
    routes: [
      "GET /openclaw/runtime",
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
      "Worker workflow shape",
      "OpenClaw real smoke scripts"
    ],
    missing: [
      "Native OpenClaw provider config format writer",
      "OpenClaw launch/restart integration",
      "Real-agent workflow replacement for remaining mock activities"
    ],
    nextActions: [
      "Connect worker execution to synced OpenClaw agents"
    ]
  },
  {
    id: "provider_registry",
    title: "Model/provider configuration center",
    status: "partial",
    summary: "Backend provider registry, local-only key status, and OpenAI-compatible verification are available; worker routing is not complete.",
    routes: [
      "GET /providers",
      "POST /providers",
      "PATCH /providers/:providerId",
      "POST /providers/:providerId/verify"
    ],
    implemented: [
      "First-run provider collection UI",
      "Real-provider smoke documentation and scripts",
      "Durable provider registry",
      "Local-only provider key storage boundary",
      "Redacted key configured/fingerprint status",
      "OpenAI-compatible provider verification endpoint"
    ],
    missing: [
      "Per-agent model/provider assignment",
      "Worker use of provider registry"
    ],
    nextActions: [
      "Connect agent registry and worker routing to provider registry"
    ]
  },
  {
    id: "agent_registry",
    title: "Agent registry",
    status: "partial",
    summary: "Backend agent registry, default Honeycomb catalog, and OpenClaw sync status tracking exist; worker execution is not complete.",
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
      "OpenClaw sync status per agent"
    ],
    missing: [
      "Worker execution against synced OpenClaw agents"
    ],
    nextActions: [
      "Connect worker execution to synced OpenClaw agents"
    ]
  },
  {
    id: "skills_mcp",
    title: "Skills and MCP registry",
    status: "partial",
    summary: "Skills and MCP servers can be persisted, toggled, and command-checked; actual MCP call execution is not complete.",
    routes: [
      "GET /skills",
      "POST /skills",
      "PATCH /skills/:skillId",
      "GET /mcp-servers",
      "POST /mcp-servers",
      "PATCH /mcp-servers/:serverId",
      "POST /mcp-servers/:serverId/check"
    ],
    implemented: [
      "Skill registry table and CRUD API",
      "MCP server registry table and CRUD API",
      "Enable/disable state",
      "MCP command availability diagnostics"
    ],
    missing: [
      "Actual MCP session/call execution",
      "Approval-gated MCP call proxy",
      "Per-agent MCP access policy enforcement"
    ],
    nextActions: [
      "Add approval-gated MCP call path after desktop approval UI"
    ]
  },
  {
    id: "web_network_tools",
    title: "Web/MCP/network tool gateway",
    status: "planned",
    summary: "File and command tools are approval-gated; web, browser, MCP, and external network calls still need a safe gateway.",
    routes: [],
    implemented: [
      "Reusable approval ledger pattern"
    ],
    missing: [
      "Approval-gated web fetch/search",
      "Approval-gated MCP call execution",
      "Output and timeout caps",
      "Network audit events"
    ],
    nextActions: [
      "Implement approval-gated MCP call proxy after MCP registry exists"
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
      "Startup catch-up for overdue tasks"
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
      "Approval-gated MCP/Web tool calls",
      "Schedule configuration UI",
      "Worker routing through provider and agent registries"
    ]
  };
}
