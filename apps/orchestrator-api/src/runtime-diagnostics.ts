import { listToolApprovals } from "../../../packages/db/src/approvals";
import { listAgentConfigs, listModelProviders } from "../../../packages/db/src/config-registry";
import { pool } from "../../../packages/db/src/pool";
import { listDueScheduledTasks, listScheduledTasks } from "../../../packages/db/src/schedules";
import { listMcpServers, listSkills } from "../../../packages/db/src/tool-registry";
import { getRuntimeCapabilities } from "./capabilities";
import { listMcpSessionStats } from "./mcp-sessions";
import { discoverOpenClawRuntime } from "./openclaw-runtime";
import {
  PROVIDER_SECRET_MISSING_ERROR,
  withLiveProviderSecretStatuses
} from "./provider-secret-status";

export type RuntimeDiagnosticStatus = "ok" | "warning" | "error" | "unknown";

export type RuntimeDiagnosticCheck = {
  id: string;
  title: string;
  status: RuntimeDiagnosticStatus;
  summary: string;
  details: Record<string, unknown>;
};

export type RuntimeDiagnosticsResponse = {
  checkedAt: string;
  status: RuntimeDiagnosticStatus;
  checks: RuntimeDiagnosticCheck[];
  recommendedActions: string[];
};

function summarizeStatus(checks: RuntimeDiagnosticCheck[]): RuntimeDiagnosticStatus {
  if (checks.some((check) => check.status === "error")) {
    return "error";
  }
  if (checks.some((check) => check.status === "warning")) {
    return "warning";
  }
  if (checks.some((check) => check.status === "unknown")) {
    return "unknown";
  }
  return "ok";
}

function pushAction(actions: string[], action: string) {
  if (!actions.includes(action)) {
    actions.push(action);
  }
}

function isLikelyRealProviderBaseUrl(baseUrl: string) {
  try {
    const parsed = new URL(baseUrl);
    const hostname = parsed.hostname.toLowerCase();
    if (parsed.protocol !== "https:") {
      return false;
    }
    if (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname.endsWith(".localhost") ||
      hostname.endsWith(".invalid") ||
      hostname === "example.invalid" ||
      hostname === "api.example.invalid"
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export async function getRuntimeDiagnostics(input: {
  openClawRootPath?: string;
} = {}): Promise<RuntimeDiagnosticsResponse> {
  const checkedAt = new Date().toISOString();
  const checks: RuntimeDiagnosticCheck[] = [];
  const recommendedActions: string[] = [];

  try {
    const result = await pool.query(`select now() as checked_at`);
    checks.push({
      id: "database",
      title: "Database",
      status: "ok",
      summary: "Database connection is available.",
      details: {
        checkedAt: result.rows[0]?.checked_at?.toISOString?.() ?? checkedAt
      }
    });
  } catch (error) {
    checks.push({
      id: "database",
      title: "Database",
      status: "error",
      summary: "Database connection failed.",
      details: {
        error: error instanceof Error ? error.message : String(error)
      }
    });
    pushAction(recommendedActions, "Repair database connection before starting runtime work.");
  }

  const capabilities = getRuntimeCapabilities();
  checks.push({
    id: "capabilities",
    title: "Runtime capabilities",
    status: capabilities.summary.planned > 0 ? "warning" : "ok",
    summary:
      capabilities.summary.planned > 0
        ? "Some backend capabilities are still planned."
        : "All tracked backend capabilities have an implemented surface.",
    details: capabilities.summary
  });
  for (const action of capabilities.recommendedNext) {
    pushAction(recommendedActions, action);
  }

  const openClaw = await discoverOpenClawRuntime(input.openClawRootPath);
  const openClawStatus =
    openClaw.selected?.status === "ready"
      ? "ok"
      : openClaw.selected?.status === "partial"
        ? "warning"
        : "error";
  checks.push({
    id: "openclaw_runtime",
    title: "OpenClaw runtime",
    status: openClawStatus,
    summary: openClaw.selected
      ? `OpenClaw runtime candidate is ${openClaw.selected.status}.`
      : "OpenClaw runtime was not found.",
    details: {
      selected: openClaw.selected,
      candidateCount: openClaw.candidates.length,
      nextActions: openClaw.nextActions
    }
  });
  for (const action of openClaw.nextActions) {
    pushAction(recommendedActions, action);
  }

  const providers = await withLiveProviderSecretStatuses(await listModelProviders());
  const verifiedProviders = providers.filter(
    (provider) => provider.verificationStatus === "succeeded"
  );
  const failedProviders = providers.filter((provider) => provider.verificationStatus === "failed");
  const configuredProviders = providers.filter((provider) => provider.apiKeyConfigured);
  const verifiedLiveProviders = verifiedProviders.filter(
    (provider) => provider.apiKeyConfigured && isLikelyRealProviderBaseUrl(provider.baseUrl)
  );
  const missingSecretProviders = providers.filter((provider) => provider.lastError === PROVIDER_SECRET_MISSING_ERROR);
  checks.push({
    id: "providers",
    title: "Model providers",
    status:
      providers.length === 0 ||
        configuredProviders.length === 0 ||
        verifiedProviders.length === 0 ||
        failedProviders.length > 0 ||
        missingSecretProviders.length > 0
        ? "warning"
        : "ok",
    summary:
      providers.length === 0
        ? "No model provider has been configured."
        : `${configuredProviders.length}/${providers.length} providers have live local API keys configured.`,
    details: {
      total: providers.length,
      configured: configuredProviders.length,
      verified: verifiedProviders.length,
      verifiedLive: verifiedLiveProviders.length,
      missingSecrets: missingSecretProviders.map((provider) => ({
        id: provider.id,
        displayName: provider.displayName
      })),
      failed: failedProviders.map((provider) => ({
        id: provider.id,
        displayName: provider.displayName,
        lastError: provider.lastError
      }))
    }
  });
  if (providers.length === 0) {
    pushAction(recommendedActions, "Configure and verify at least one model provider.");
  }
  if (providers.length > 0 && configuredProviders.length === 0) {
    pushAction(recommendedActions, "Add a local API key for at least one model provider.");
  }
  if (missingSecretProviders.length > 0) {
    pushAction(recommendedActions, "Re-enter missing provider API keys so local secret storage and database state match.");
  }
  if (configuredProviders.length > 0 && verifiedLiveProviders.length === 0) {
    pushAction(recommendedActions, "Verify at least one live external model provider before real OpenClaw E2E.");
  }
  if (failedProviders.length > 0) {
    pushAction(recommendedActions, "Re-verify failed model providers after checking model and API key.");
  }

  const agents = await listAgentConfigs();
  const requiredAgents = agents.filter((agent) => agent.required);
  const unsyncedAgents = requiredAgents.filter((agent) => agent.openclawSyncStatus !== "synced");
  const disabledRequiredAgents = requiredAgents.filter((agent) => !agent.enabled);
  checks.push({
    id: "agents",
    title: "Agent registry",
    status: unsyncedAgents.length > 0 || disabledRequiredAgents.length > 0 ? "warning" : "ok",
    summary: `${requiredAgents.length} required agents are registered.`,
    details: {
      total: agents.length,
      required: requiredAgents.length,
      unsynced: unsyncedAgents.map((agent) => agent.id),
      disabledRequired: disabledRequiredAgents.map((agent) => agent.id)
    }
  });
  if (unsyncedAgents.length > 0) {
    pushAction(recommendedActions, "Run OpenClaw sync after provider and agent configuration changes.");
  }

  const realProviderE2EReady =
    openClaw.selected?.status === "ready" &&
    verifiedLiveProviders.length > 0 &&
    configuredProviders.length > 0 &&
    requiredAgents.length > 0 &&
    unsyncedAgents.length === 0 &&
    disabledRequiredAgents.length === 0;
  checks.push({
    id: "real_provider_e2e",
    title: "Real provider E2E readiness",
    status: realProviderE2EReady ? "ok" : "warning",
    summary: realProviderE2EReady
      ? "Installed OpenClaw, verified provider, and synced required agents are ready for real E2E."
      : "Real OpenClaw provider E2E is not ready yet.",
    details: {
      openclawReady: openClaw.selected?.status === "ready",
      verifiedLiveProviders: verifiedLiveProviders.map((provider) => ({
        id: provider.id,
        displayName: provider.displayName,
        defaultModel: provider.defaultModel,
        lastVerifiedAt: provider.lastVerifiedAt
      })),
      verifiedProviderCount: verifiedProviders.length,
      configuredProviderCount: configuredProviders.length,
      requiredAgentCount: requiredAgents.length,
      unsyncedRequiredAgents: unsyncedAgents.map((agent) => agent.id),
      disabledRequiredAgents: disabledRequiredAgents.map((agent) => agent.id)
    }
  });
  if (!realProviderE2EReady) {
    if (openClaw.selected?.status !== "ready") {
      pushAction(recommendedActions, "Repair or select a ready OpenClaw runtime before real provider E2E.");
    }
    if (verifiedLiveProviders.length === 0) {
      pushAction(recommendedActions, "Verify a live external provider with a local API key before running real OpenClaw E2E.");
    }
  }

  const pendingApprovals = await listToolApprovals({ status: "pending", limit: 200 });
  checks.push({
    id: "approvals",
    title: "Tool approvals",
    status: pendingApprovals.approvals.length > 0 ? "warning" : "ok",
    summary:
      pendingApprovals.approvals.length > 0
        ? `${pendingApprovals.approvals.length} tool approvals are waiting for a decision.`
        : "No pending tool approvals.",
    details: {
      pending: pendingApprovals.approvals.length
    }
  });
  if (pendingApprovals.approvals.length > 0) {
    pushAction(recommendedActions, "Review pending tool approvals in the desktop approval queue.");
  }

  const skills = await listSkills();
  const mcpServers = await listMcpServers();
  const enabledMcpServers = mcpServers.filter((server) => server.enabled);
  const unavailableMcpServers = enabledMcpServers.filter(
    (server) => server.status === "missing" || server.status === "failed"
  );
  checks.push({
    id: "skills_mcp",
    title: "Skills and MCP",
    status: unavailableMcpServers.length > 0 ? "warning" : "ok",
    summary: `${skills.length} skills and ${mcpServers.length} MCP servers are registered.`,
    details: {
      skills: skills.length,
      enabledSkills: skills.filter((skill) => skill.enabled).length,
      mcpServers: mcpServers.length,
      enabledMcpServers: enabledMcpServers.length,
      unavailableMcpServers: unavailableMcpServers.map((server) => ({
        id: server.id,
        name: server.name,
        status: server.status,
        lastError: server.lastError
      }))
    }
  });
  if (unavailableMcpServers.length > 0) {
    pushAction(recommendedActions, "Run MCP diagnostics and repair missing commands.");
  }

  const mcpSessions = listMcpSessionStats();
  checks.push({
    id: "mcp_sessions",
    title: "MCP sessions",
    status: "ok",
    summary:
      mcpSessions.length === 0
        ? "No long-lived MCP sessions are open."
        : `${mcpSessions.length} long-lived MCP session(s) are open.`,
    details: {
      open: mcpSessions.length,
      sessions: mcpSessions
    }
  });

  const schedules = await listScheduledTasks({ limit: 200 });
  const dueSchedules = await listDueScheduledTasks(new Date(), 200);
  const enabledSchedules = schedules.schedules.filter((schedule) => schedule.enabled);
  checks.push({
    id: "schedules",
    title: "Scheduled tasks",
    status: dueSchedules.length > 0 ? "warning" : "ok",
    summary:
      schedules.schedules.length === 0
        ? "No scheduled tasks have been created."
        : `${enabledSchedules.length}/${schedules.schedules.length} scheduled tasks are enabled.`,
    details: {
      total: schedules.schedules.length,
      enabled: enabledSchedules.length,
      due: dueSchedules.map((schedule) => ({
        id: schedule.id,
        title: schedule.title,
        nextRunAt: schedule.nextRunAt
      }))
    }
  });
  if (dueSchedules.length > 0) {
    pushAction(recommendedActions, "Run due scheduled tasks or start the scheduler worker.");
  }

  return {
    checkedAt,
    status: summarizeStatus(checks),
    checks,
    recommendedActions
  };
}
