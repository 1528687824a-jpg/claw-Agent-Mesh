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
      "GET /runtime/capabilities"
    ],
    implemented: [
      "Runtime log queries",
      "Usage summary",
      "Session event stream",
      "Machine-readable capability inventory"
    ],
    missing: [
      "Desktop diagnostics page still needs to consume this endpoint"
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
      "Session event emission"
    ],
    missing: [
      "Desktop approval queue UI",
      "Per-tool approval policy registry"
    ],
    nextActions: [
      "Build desktop approval queue and then add policy defaults per tool"
    ]
  },
  {
    id: "openclaw_sync",
    title: "OpenClaw real-agent sync",
    status: "partial",
    summary: "Workflow shape and templates exist, but first-class provisioning and validation APIs are not complete.",
    routes: [],
    implemented: [
      "Agent prompt templates",
      "Example OpenClaw multi-agent config",
      "Worker workflow shape",
      "OpenClaw real smoke scripts"
    ],
    missing: [
      "Backend agent provisioning API",
      "Backend OpenClaw runtime discovery API",
      "Backend OpenClaw config sync API",
      "Validation that OpenClaw can see every required agent"
    ],
    nextActions: [
      "Add OpenClaw runtime discovery",
      "Add agent registry",
      "Add OpenClaw sync and validation APIs"
    ]
  },
  {
    id: "provider_registry",
    title: "Model/provider configuration center",
    status: "partial",
    summary: "First-run UI collects model and API key, but backend provider registry and child-agent routing are not complete.",
    routes: [],
    implemented: [
      "First-run provider collection UI",
      "Real-provider smoke documentation and scripts"
    ],
    missing: [
      "Durable local provider registry",
      "Key configured/redacted status API",
      "Per-agent model/provider assignment",
      "Provider verification history"
    ],
    nextActions: [
      "Add provider tables and local-only secret storage boundary",
      "Expose provider CRUD and verification APIs"
    ]
  },
  {
    id: "agent_registry",
    title: "Agent registry",
    status: "planned",
    summary: "Product needs panel supervisor plus child agents, but backend CRUD/status/sync APIs are not implemented yet.",
    routes: [],
    implemented: [
      "Prompt templates",
      "Front-end agent configuration panels"
    ],
    missing: [
      "Agent table",
      "Agent config API",
      "Panel-agent name propagation from first-run setup",
      "Required video-agent provisioning",
      "OpenClaw sync status per agent"
    ],
    nextActions: [
      "Add agent registry schema and APIs",
      "Use first-run panel-agent name as the main/panel agent id label"
    ]
  },
  {
    id: "skills_mcp",
    title: "Skills and MCP registry",
    status: "planned",
    summary: "Skills/MCP are visible in product concept and UI copy, but backend persistence and diagnostics are not implemented.",
    routes: [],
    implemented: [
      "UI placeholders and prompt context text"
    ],
    missing: [
      "Skill registry",
      "MCP server registry",
      "Enable/disable state",
      "Diagnostics",
      "Per-agent access policy"
    ],
    nextActions: [
      "Add skills and MCP registry tables",
      "Add diagnostics endpoint and approval-gated MCP call path"
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
    status: "planned",
    summary: "One-time, daily, interval, and manual scheduled task execution are not implemented.",
    routes: [],
    implemented: [],
    missing: [
      "Schedule table",
      "Scheduler runner",
      "Wake/startup catch-up behavior",
      "Workspace/model/reasoning configuration per schedule"
    ],
    nextActions: [
      "Add schedule schema after agent/provider registries are in place"
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
    summary: "Launcher and package layout checks exist; full installer/runtime dependency diagnostics are still incomplete.",
    routes: [],
    implemented: [
      "Desktop launcher repair",
      "Package layout audit",
      "No-secret scan",
      "Windows local Tauri shell smoke"
    ],
    missing: [
      "OpenClaw dependency discovery",
      "WSL/Docker/database readiness checks",
      "Provider diagnostics",
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
      "OpenClaw runtime discovery",
      "Provider registry with redacted local key status",
      "Agent registry and OpenClaw sync",
      "Desktop approval queue UI",
      "Skills/MCP registry"
    ]
  };
}
