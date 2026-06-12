import "dotenv/config";
import express from "express";
import { z } from "zod";
import {
  archiveJobSession,
  appendJobEvent,
  cancelJob,
  createJob,
  getJob,
  getJobByFeishuMessageId,
  getJobBySessionId,
  InvalidJobListCursorError,
  listJobs,
  restoreJobSession
} from "../../../packages/db/src/jobs";
import {
  consumeToolApproval,
  createToolApprovalRequest,
  decideToolApproval,
  expirePendingToolApprovals,
  getToolApproval,
  listToolApprovals
} from "../../../packages/db/src/approvals";
import { markModelCallFailedUnknownOutcome } from "../../../packages/db/src/model-calls";
import {
  listExperiences,
  setExperienceStatus
} from "../../../packages/db/src/experience";
import {
  getGroupMessagesForJob,
  getJobDetails,
  getJobTimeline,
  InvalidTimelineCursorError
} from "../../../packages/db/src/pipeline";
import {
  createPlanForJob,
  createPlanItem,
  getPlan,
  listPlans,
  updatePlan,
  updatePlanItem
} from "../../../packages/db/src/plans";
import {
  compressSession,
  getRuntimeUsage,
  getSessionEvents,
  getSessionEventsAfter,
  listRuntimeLogs,
  listSessions
} from "../../../packages/db/src/runtime";
import {
  getAgentConfig,
  getModelProvider,
  listAgentConfigs,
  listModelProviders,
  patchAgentConfig,
  patchModelProvider,
  seedDefaultAgentConfigs,
  upsertAgentConfig,
  upsertModelProvider
} from "../../../packages/db/src/config-registry";
import {
  getRegisteredWorkspaceByRootKey,
  listRegisteredWorkspaces,
  markRegisteredWorkspaceUsed,
  upsertRegisteredWorkspace
} from "../../../packages/db/src/workspace-registry";
import {
  getAgentMcpPolicyFor,
  getMcpServer,
  isAgentMcpPolicyAllowed,
  listAgentMcpPolicies,
  listMcpServers,
  listSkills,
  patchAgentMcpPolicy,
  patchMcpServer,
  patchSkill,
  upsertAgentMcpPolicy,
  upsertMcpServer,
  upsertSkill
} from "../../../packages/db/src/tool-registry";
import {
  getScheduledTask,
  listDueScheduledTasks,
  listScheduledTasks,
  markScheduledTaskTriggered,
  patchScheduledTask,
  upsertScheduledTask
} from "../../../packages/db/src/schedules";
import {
  formatWorkspaceCommand,
  getWorkspaceGitStatus,
  inspectWorkspace,
  listWorkspaceFiles,
  prepareWorkspaceFileWrite,
  readWorkspaceFile,
  resolveWorkspaceDirectoryTarget,
  runWorkspaceCommand,
  writeWorkspaceFile,
  WorkspacePathError
} from "./workspaces";
import {
  normalizeWorkspaceRegistrationTarget,
  normalizeWorkspaceRootPath,
  workspaceApprovalTarget,
  workspaceRootKey
} from "./workspace-security";
import {
  buildWebSearchUrl,
  formatBrowserSnapshotCommand,
  formatWebFetchCommand,
  formatWebSearchCommand,
  normalizeWebFetchUrl,
  runBrowserSnapshot,
  runWebFetch,
  runWebSearch,
  WebFetchError
} from "./web-tools";
import {
  EXPERIENCE_STATUSES,
  INGRESS_ORIGINS,
  JOB_STATUSES,
  MCP_SERVER_STATUSES,
  PROVIDER_VERIFICATION_STATUSES,
  ROUTING_MODES,
  AGENT_SYNC_STATUSES,
  SCHEDULE_TASK_STATUSES,
  SCHEDULE_TYPES,
  TASK_PLAN_ITEM_STATUSES,
  TASK_PLAN_STATUSES,
  TOOL_APPROVAL_STATUSES,
  TOOL_RISK_LEVELS,
  type ExperienceStatus,
  type ToolApprovalRecord
} from "../../../packages/shared/src/types";
import { launchDbos, startJobWorkflow } from "../../dbos-worker/src/dbos-runtime";
import { ingressAdapters } from "./adapters";
import { getRuntimeCapabilities } from "./capabilities";
import { discoverOpenClawRuntime } from "./openclaw-runtime";
import {
  getOpenClawRuntimeControlStatus,
  runOpenClawRuntimeCommand,
  type OpenClawRuntimeAction
} from "./openclaw-runtime-control";
import {
  applyOpenClawSyncPlan,
  buildOpenClawSyncPlan,
  OpenClawSyncSafetyError,
  validateOpenClawSync
} from "./openclaw-sync";
import {
  fingerprintSecret,
  getProviderApiKeyStatus,
  readProviderApiKey,
  saveProviderApiKey
} from "../../../packages/runtime/src/local-secrets";
import {
  verifyOpenAiCompatibleProvider,
  type ProviderVerificationResult
} from "./provider-verification";
import {
  withLiveProviderSecretStatus,
  withLiveProviderSecretStatuses
} from "./provider-secret-status";
import { checkMcpCommand } from "./mcp-diagnostics";
import { requireApiToken, timingSafeEqualString } from "./api-auth";
import {
  evaluateAgentNetworkPolicy,
  type AgentNetworkOperation
} from "./network-policy";
import {
  formatMcpListCommand,
  formatMcpListTarget,
  formatMcpToolCommand,
  formatMcpToolTarget,
  McpToolError,
  runMcpResourcesList,
  runMcpToolCall,
  runMcpToolsList
} from "./mcp-tools";
import { closeAllMcpSessions, invalidateMcpSession } from "./mcp-sessions";
import { closePool } from "../../../packages/db/src/pool";
import { getRuntimeDiagnostics } from "./runtime-diagnostics";

const unstickModelCallSchema = z.object({
  jobId: z.string().min(1),
  idempotencyKey: z.string().min(1),
  reason: z.string().optional(),
  restartWorkflow: z.boolean().optional().default(true)
});

const timelineQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(1000).optional(),
  since: z.string().datetime({ offset: true }).optional(),
  cursor: z.string().min(1).max(2000).optional()
});

const runtimeLogsQuerySchema = z.object({
  source: z.enum(["job_event", "agent_event", "model_call"]).optional(),
  jobId: z.string().trim().min(1).max(200).optional(),
  sessionId: z.string().trim().min(1).max(300).optional(),
  since: z.string().datetime({ offset: true }).optional(),
  until: z.string().datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional()
});

const runtimeUsageQuerySchema = z.object({
  since: z.string().datetime({ offset: true }).optional(),
  until: z.string().datetime({ offset: true }).optional()
});

const runtimeDiagnosticsQuerySchema = z.object({
  openClawRootPath: z.string().trim().min(1).max(2000).optional()
});

const openClawRuntimeQuerySchema = z.object({
  rootPath: z.string().trim().min(1).max(2000).optional()
});

const openClawSyncSchema = z.object({
  rootPath: z.string().trim().min(1).max(2000).optional(),
  allowDiscoveredUserRuntime: z.boolean().optional()
});

const openClawRuntimeActionSchema = z.object({
  action: z.enum(["status", "start", "restart", "stop"])
});

const openClawRuntimeCommandSchema = z.object({
  rootPath: z.string().trim().min(1).max(2000).optional(),
  timeoutMs: z.number().int().min(1000).max(300000).optional()
});

const providerSchema = z.object({
  id: z.string().trim().min(1).max(160).optional(),
  displayName: z.string().trim().min(1).max(200),
  baseUrl: z.string().trim().url().max(1000),
  defaultModel: z.string().trim().min(1).max(300).nullable().optional(),
  apiKey: z.string().min(1).max(10000).optional(),
  verify: z.boolean().optional(),
  metadata: z.record(z.unknown()).optional()
});

const patchProviderSchema = providerSchema.partial().extend({
  verificationStatus: z.enum(PROVIDER_VERIFICATION_STATUSES).optional(),
  lastError: z.string().trim().max(1000).nullable().optional()
});

const verifyProviderSchema = z.object({
  apiKey: z.string().min(1).max(10000).optional(),
  model: z.string().trim().min(1).max(300).optional()
});

const verifyProvidersBatchSchema = z.object({
  providerIds: z.array(z.string().trim().min(1).max(160)).max(50).optional(),
  providers: z.array(z.object({
    providerId: z.string().trim().min(1).max(160),
    apiKey: z.string().min(1).max(10000).optional(),
    model: z.string().trim().min(1).max(300).optional()
  })).max(50).optional(),
  timeoutMs: z.number().int().min(500).max(60000).optional()
});

const agentConfigSchema = z.object({
  id: z.string().trim().min(1).max(160),
  displayName: z.string().trim().min(1).max(200),
  agentRole: z.string().trim().min(1).max(120),
  required: z.boolean().optional(),
  enabled: z.boolean().optional(),
  providerId: z.string().trim().min(1).max(160).nullable().optional(),
  model: z.string().trim().min(1).max(300).nullable().optional(),
  apiKeyConfigured: z.boolean().optional(),
  workspacePath: z.string().trim().min(1).max(2000).nullable().optional(),
  promptTemplatePath: z.string().trim().min(1).max(2000).nullable().optional(),
  tools: z.array(z.string().trim().min(1).max(200)).max(100).optional(),
  openclawSyncStatus: z.enum(AGENT_SYNC_STATUSES).optional(),
  openclawAgentPath: z.string().trim().min(1).max(2000).nullable().optional(),
  lastError: z.string().trim().max(1000).nullable().optional(),
  metadata: z.record(z.unknown()).optional()
});

const patchAgentConfigSchema = agentConfigSchema.partial().omit({ id: true });

const seedDefaultAgentsSchema = z.object({
  panelAgentName: z.string().trim().min(1).max(200).optional(),
  providerId: z.string().trim().min(1).max(160).nullable().optional(),
  model: z.string().trim().min(1).max(300).nullable().optional()
});

const skillSchema = z.object({
  id: z.string().trim().min(1).max(160).optional(),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).nullable().optional(),
  enabled: z.boolean().optional(),
  source: z.string().trim().min(1).max(120).optional(),
  config: z.record(z.unknown()).optional(),
  diagnostics: z.record(z.unknown()).optional()
});

const patchSkillSchema = skillSchema.partial();

const mcpServerSchema = z.object({
  id: z.string().trim().min(1).max(160).optional(),
  name: z.string().trim().min(1).max(200),
  command: z.string().trim().min(1).max(500),
  args: z.array(z.string().max(2000)).max(100).optional(),
  envKeys: z.array(z.string().trim().min(1).max(200)).max(100).optional(),
  enabled: z.boolean().optional(),
  status: z.enum(MCP_SERVER_STATUSES).optional(),
  lastError: z.string().trim().max(1000).nullable().optional(),
  config: z.record(z.unknown()).optional()
});

const patchMcpServerSchema = mcpServerSchema.partial();

const mcpToolCallSchema = z.object({
  toolName: z.string().trim().min(1).max(200),
  arguments: z.record(z.unknown()).optional(),
  timeoutMs: z.number().int().min(1000).max(120000).optional(),
  maxOutputBytes: z.number().int().min(1).max(1024 * 1024).optional(),
  approvalId: z.string().trim().min(1).max(200)
});

const mcpListSchema = z.object({
  cursor: z.string().trim().min(1).max(2000).optional(),
  timeoutMs: z.number().int().min(1000).max(120000).optional(),
  maxOutputBytes: z.number().int().min(1).max(1024 * 1024).optional(),
  approvalId: z.string().trim().min(1).max(200)
});

const mcpPolicyQuerySchema = z.object({
  agentId: z.string().trim().min(1).max(160).optional(),
  serverId: z.string().trim().min(1).max(160).optional()
});

const mcpPolicySchema = z.object({
  id: z.string().trim().min(1).max(160).optional(),
  agentId: z.string().trim().min(1).max(160),
  serverId: z.string().trim().min(1).max(160),
  enabled: z.boolean().optional(),
  allowToolsList: z.boolean().optional(),
  allowResourcesList: z.boolean().optional(),
  allowAllTools: z.boolean().optional(),
  allowedTools: z.array(z.string().trim().min(1).max(200)).max(200).optional(),
  metadata: z.record(z.unknown()).optional()
});

const patchMcpPolicySchema = mcpPolicySchema.partial().omit({
  id: true,
  agentId: true,
  serverId: true
});

const scheduleBaseSchema = z.object({
  id: z.string().trim().min(1).max(160).optional(),
  title: z.string().trim().min(1).max(200),
  prompt: z.string().trim().min(1).max(8000),
  scheduleType: z.enum(SCHEDULE_TYPES).optional(),
  enabled: z.boolean().optional(),
  workspacePath: z.string().trim().min(1).max(2000).nullable().optional(),
  routingMode: z.enum(ROUTING_MODES).optional(),
  maxModelCalls: z.number().int().min(1).max(100).optional(),
  providerId: z.string().trim().min(1).max(160).nullable().optional(),
  agentId: z.string().trim().min(1).max(160).nullable().optional(),
  runAt: z.string().datetime({ offset: true }).nullable().optional(),
  intervalSeconds: z.number().int().min(60).max(60 * 60 * 24 * 365).nullable().optional(),
  nextRunAt: z.string().datetime({ offset: true }).nullable().optional(),
  status: z.enum(SCHEDULE_TASK_STATUSES).optional(),
  lastError: z.string().trim().max(1000).nullable().optional(),
  metadata: z.record(z.unknown()).optional()
});

const scheduleSchema = scheduleBaseSchema.superRefine((value, context) => {
  if (value.scheduleType === "once" && !value.runAt) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "runAt_required_for_once_schedule",
      path: ["runAt"]
    });
  }
  if (value.scheduleType === "interval" && !value.intervalSeconds) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "intervalSeconds_required_for_interval_schedule",
      path: ["intervalSeconds"]
    });
  }
});

const patchScheduleSchema = scheduleBaseSchema.partial();

const listSchedulesQuerySchema = z.object({
  status: z.enum(SCHEDULE_TASK_STATUSES).optional(),
  enabled: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional()
});

const dueSchedulesQuerySchema = z.object({
  now: z.string().datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional()
});

const triggerScheduleSchema = z.object({
  startWorkflow: z.boolean().optional().default(true),
  force: z.boolean().optional().default(false),
  requesterId: z.string().trim().min(1).max(200).optional()
});

const listSessionsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  status: z.enum(JOB_STATUSES).optional(),
  prompt: z.string().trim().min(1).max(300).optional()
});

const sessionEventsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(1000).optional()
});

const sessionEventsStreamQuerySchema = z.object({
  afterSeq: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  pollMs: z.coerce.number().int().min(250).max(10000).optional(),
  heartbeatMs: z.coerce.number().int().min(5000).max(60000).optional()
});

const archiveSessionSchema = z.object({
  retentionDays: z.number().int().min(1).max(3650).optional(),
  reason: z.string().max(500).optional(),
  requesterId: z.string().max(200).optional()
});

const restoreSessionSchema = z.object({
  reason: z.string().max(500).optional(),
  requesterId: z.string().max(200).optional()
});

const forkSessionSchema = z.object({
  prompt: z.string().min(1).optional(),
  inheritWorkdir: z.boolean().optional().default(true),
  startWorkflow: z.boolean().optional().default(true),
  routingMode: z.enum(ROUTING_MODES).optional(),
  maxModelCalls: z.number().int().min(1).max(100).optional(),
  classicFinalGateEnabled: z.boolean().optional(),
  discussionRounds: z.number().int().min(1).max(10).optional(),
  requesterId: z.string().max(200).optional()
});

const compressSessionSchema = z.object({
  maxEvents: z.number().int().min(10).max(300).optional(),
  reason: z.string().max(500).optional()
});

const listPlansQuerySchema = z.object({
  jobId: z.string().trim().min(1).max(200).optional(),
  status: z.enum(TASK_PLAN_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional()
});

const createJobPlanSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  summary: z.string().trim().max(2000).optional(),
  source: z.string().trim().min(1).max(80).optional(),
  sourceArtifactId: z.string().trim().min(1).max(240).nullable().optional(),
  metadata: z.record(z.unknown()).optional(),
  syncItems: z.boolean().optional()
});

const updatePlanSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  summary: z.string().trim().max(2000).nullable().optional(),
  status: z.enum(TASK_PLAN_STATUSES).optional(),
  metadata: z.record(z.unknown()).optional()
});

const createPlanItemSchema = z.object({
  title: z.string().trim().min(1).max(300),
  body: z.string().trim().max(4000).nullable().optional(),
  status: z.enum(TASK_PLAN_ITEM_STATUSES).optional(),
  agentId: z.string().trim().min(1).max(200).nullable().optional(),
  stageId: z.string().trim().min(1).max(240).nullable().optional(),
  artifactId: z.string().trim().min(1).max(240).nullable().optional(),
  acceptanceCriteria: z.array(z.string().trim().min(1).max(500)).max(30).optional(),
  metadata: z.record(z.unknown()).optional()
});

const updatePlanItemSchema = createPlanItemSchema.partial().extend({
  title: z.string().trim().min(1).max(300).optional()
});

const workspaceRootQuerySchema = z.object({
  rootPath: z.string().trim().min(1).max(2000)
});

const listRegisteredWorkspacesQuerySchema = z.object({
  enabled: z.coerce.boolean().optional()
});

const workspaceRegisterSchema = z.object({
  rootPath: z.string().trim().min(1).max(2000),
  displayName: z.string().trim().min(1).max(200).nullable().optional(),
  approvalId: z.string().trim().min(1).max(200),
  registeredBy: z.string().trim().min(1).max(200).optional(),
  metadata: z.record(z.unknown()).optional()
});

const workspaceFilesQuerySchema = workspaceRootQuerySchema.extend({
  subpath: z.string().trim().max(2000).optional(),
  depth: z.coerce.number().int().min(0).max(8).optional(),
  limit: z.coerce.number().int().min(1).max(5000).optional(),
  includeHidden: z.coerce.boolean().optional()
});

const workspaceFileQuerySchema = workspaceRootQuerySchema.extend({
  subpath: z.string().trim().min(1).max(2000),
  maxBytes: z.coerce.number().int().min(1).max(1024 * 1024).optional()
});

const workspaceWriteFileSchema = z.object({
  rootPath: z.string().trim().min(1).max(2000),
  subpath: z.string().trim().min(1).max(2000),
  content: z.string().max(1024 * 1024),
  mode: z.enum(["create", "overwrite", "append"]).optional(),
  createParents: z.boolean().optional(),
  approvalId: z.string().trim().min(1).max(200)
});

const workspaceCommandRunSchema = z.object({
  rootPath: z.string().trim().min(1).max(2000),
  cwdSubpath: z.string().trim().max(2000).optional(),
  command: z.string().trim().min(1).max(200),
  args: z.array(z.string().max(2000)).max(80).optional(),
  timeoutMs: z.number().int().min(1000).max(30000).optional(),
  maxOutputBytes: z.number().int().min(1).max(256 * 1024).optional(),
  approvalId: z.string().trim().min(1).max(200)
});

const webFetchRunSchema = z.object({
  url: z.string().trim().url().max(4000),
  timeoutMs: z.number().int().min(1000).max(60000).optional(),
  maxBytes: z.number().int().min(1).max(1024 * 1024).optional(),
  allowPrivateNetwork: z.boolean().optional(),
  approvalId: z.string().trim().min(1).max(200)
});

const webSearchRunSchema = z.object({
  query: z.string().trim().min(1).max(500),
  endpointUrl: z.string().trim().url().max(4000).optional(),
  timeoutMs: z.number().int().min(1000).max(60000).optional(),
  maxBytes: z.number().int().min(1).max(1024 * 1024).optional(),
  maxResults: z.number().int().min(1).max(20).optional(),
  allowPrivateNetwork: z.boolean().optional(),
  approvalId: z.string().trim().min(1).max(200)
});

const browserSnapshotRunSchema = z.object({
  url: z.string().trim().url().max(4000),
  timeoutMs: z.number().int().min(1000).max(60000).optional(),
  maxBytes: z.number().int().min(1).max(1024 * 1024).optional(),
  maxLinks: z.number().int().min(0).max(100).optional(),
  allowPrivateNetwork: z.boolean().optional(),
  approvalId: z.string().trim().min(1).max(200)
});

const listApprovalsQuerySchema = z.object({
  status: z.enum(TOOL_APPROVAL_STATUSES).optional(),
  jobId: z.string().trim().min(1).max(200).optional(),
  sessionId: z.string().trim().min(1).max(300).optional(),
  agentId: z.string().trim().min(1).max(200).optional(),
  riskLevel: z.enum(TOOL_RISK_LEVELS).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional()
});

const createApprovalSchema = z.object({
  jobId: z.string().trim().min(1).max(200).optional(),
  sessionId: z.string().trim().min(1).max(300).optional(),
  stageId: z.string().trim().min(1).max(240).nullable().optional(),
  agentId: z.string().trim().min(1).max(200),
  requesterActor: z.string().trim().min(1).max(200).optional(),
  toolName: z.string().trim().min(1).max(200),
  actionType: z.string().trim().min(1).max(200),
  riskLevel: z.enum(TOOL_RISK_LEVELS).optional(),
  reason: z.string().trim().max(2000).nullable().optional(),
  command: z.string().trim().max(4000).nullable().optional(),
  target: z.string().trim().max(2000).nullable().optional(),
  input: z.record(z.unknown()).optional(),
  policy: z.record(z.unknown()).optional(),
  expiresAt: z.string().datetime({ offset: true }).nullable().optional()
}).refine((value) => Boolean(value.jobId || value.sessionId), {
  message: "jobId_or_sessionId_required"
});

const decideApprovalSchema = z.object({
  decidedBy: z.string().trim().min(1).max(200).optional(),
  decisionReason: z.string().trim().max(2000).nullable().optional()
});

const consumeApprovalSchema = z.object({
  consumedBy: z.string().trim().min(1).max(200).optional()
});

const WORKSPACE_WRITE_TOOL_NAMES = new Set(["workspace.writeFile", "workspace.write"]);
const WORKSPACE_WRITE_ACTION_TYPES = new Set(["file_write", "workspace_file_write"]);
const WORKSPACE_REGISTER_TOOL_NAMES = new Set(["workspace.register", "workspace.addRoot"]);
const WORKSPACE_REGISTER_ACTION_TYPES = new Set(["workspace_register", "workspace_root_register"]);
const WORKSPACE_COMMAND_TOOL_NAMES = new Set([
  "workspace.runCommand",
  "workspace.command",
  "workspace.shell"
]);
const WORKSPACE_COMMAND_ACTION_TYPES = new Set([
  "command_execute",
  "workspace_command_execute"
]);
const WEB_FETCH_TOOL_NAMES = new Set(["web.fetch", "network.fetch", "http.fetch"]);
const WEB_FETCH_ACTION_TYPES = new Set(["web_fetch", "network_fetch", "http_get"]);
const WEB_SEARCH_TOOL_NAMES = new Set(["web.search", "network.search", "search.web"]);
const WEB_SEARCH_ACTION_TYPES = new Set(["web_search", "network_search", "search_query"]);
const BROWSER_SNAPSHOT_TOOL_NAMES = new Set(["browser.snapshot", "browser.fetch", "web.snapshot"]);
const BROWSER_SNAPSHOT_ACTION_TYPES = new Set(["browser_snapshot", "browser_fetch", "web_snapshot"]);
const MCP_TOOL_CALL_TOOL_NAMES = new Set(["mcp.call", "mcp.toolCall", "mcp.tools/call"]);
const MCP_TOOL_CALL_ACTION_TYPES = new Set(["mcp_call", "mcp_tool_call", "mcp_tools_call"]);
const MCP_LIST_TOOL_NAMES = new Set(["mcp.list", "mcp.tools/list", "mcp.resources/list"]);
const MCP_LIST_ACTION_TYPES = new Set(["mcp_list", "mcp_tools_list", "mcp_resources_list"]);

function normalizeApprovalTarget(target: string | null) {
  if (!target) {
    return null;
  }
  return target.trim().replace(/\\/g, "/").replace(/^\/+/, "").replace(/^\.\//, "");
}

function normalizeApprovalCommand(command: string | null) {
  return command?.trim() || null;
}

async function requireRegisteredWorkspaceRoot(rootPath: string, response: express.Response) {
  const rootPathKey = workspaceRootKey(rootPath);
  const workspace = await getRegisteredWorkspaceByRootKey(rootPathKey);
  if (!workspace?.enabled) {
    response.status(403).json({
      error: "workspace_not_registered",
      rootPath: normalizeWorkspaceRootPath(rootPath),
      rootPathKey,
      registerTarget: workspaceApprovalTarget(rootPathKey)
    });
    return null;
  }

  await markRegisteredWorkspaceUsed(rootPathKey);
  return workspace.rootPath;
}

function approvalFlag(value: Record<string, unknown> | null | undefined, key: string) {
  return value?.[key] === true;
}

function previewJson(value: unknown, maxLength = 4000) {
  try {
    return JSON.stringify(value).slice(0, maxLength);
  } catch {
    return String(value).slice(0, maxLength);
  }
}

async function requireAgentNetworkPolicy(input: {
  approval: ToolApprovalRecord;
  operation: AgentNetworkOperation;
  url: string;
  allowPrivateNetwork: boolean;
  response: express.Response;
}) {
  const agent = await getAgentConfig(input.approval.agentId);
  const decision = evaluateAgentNetworkPolicy({
    agent,
    operation: input.operation,
    url: input.url,
    allowPrivateNetwork: input.allowPrivateNetwork
  });

  if (decision.allowed) {
    return true;
  }

  await appendJobEvent(
    input.approval.jobId,
    "tool.network_policy_denied",
    {
      approvalId: input.approval.id,
      agentId: input.approval.agentId,
      operation: input.operation,
      target: input.url,
      reason: decision.reason,
      policySource: decision.policySource,
      policy: decision.policy
    },
    {
      actor: "network-policy",
      stageId: input.approval.stageId
    }
  );

  input.response.status(403).json({
    error: "network_policy_denied",
    decision
  });
  return false;
}

function mcpDiscoveryConfigEntry(result: unknown) {
  const value = result && typeof result === "object" ? (result as Record<string, unknown>) : {};
  const tools = Array.isArray(value.tools) ? value.tools : undefined;
  const resources = Array.isArray(value.resources) ? value.resources : undefined;
  return {
    checkedAt: new Date().toISOString(),
    count: tools?.length ?? resources?.length ?? null,
    result
  };
}

async function requireMcpPolicy(input: {
  agentId: string;
  serverId: string;
  operation: "tools/list" | "resources/list" | "tools/call";
  toolName?: string;
}) {
  const policy = await getAgentMcpPolicyFor({
    agentId: input.agentId,
    serverId: input.serverId
  });
  if (!policy) {
    throw new McpToolError("mcp_policy_denied", "Agent is not allowed to use this MCP operation.", {
      agentId: input.agentId,
      serverId: input.serverId,
      operation: input.operation,
      toolName: input.toolName ?? null,
      policyId: null
    });
  }
  if (!isAgentMcpPolicyAllowed(policy, input)) {
    throw new McpToolError("mcp_policy_denied", "Agent is not allowed to use this MCP operation.", {
      agentId: input.agentId,
      serverId: input.serverId,
      operation: input.operation,
      toolName: input.toolName ?? null,
      policyId: policy?.id ?? null
    });
  }
  return policy;
}

function stableIdFromName(prefix: string, value: string) {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${prefix}-${slug || "default"}`;
}

function withProviderVerificationMetadata(
  metadata: Record<string, unknown> | null | undefined,
  verification: ProviderVerificationResult,
  model: string | null
) {
  return {
    ...(metadata ?? {}),
    verification: {
      checkedAt: verification.checkedAt,
      status: verification.status,
      ok: verification.ok,
      statusCode: verification.statusCode,
      latencyMs: verification.latencyMs,
      model,
      message: verification.message
    }
  };
}

function providerVerificationFailure(message: string): ProviderVerificationResult {
  return {
    ok: false,
    status: "failed",
    checkedAt: new Date().toISOString(),
    latencyMs: 0,
    statusCode: null,
    message
  };
}

type ProviderVerificationRequest = {
  providerId: string;
  apiKey?: string;
  model?: string;
};

const listJobsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  status: z.enum(JOB_STATUSES).optional(),
  ingressOrigin: z.enum(INGRESS_ORIGINS).optional(),
  prompt: z.string().trim().min(1).max(300).optional(),
  since: z.string().datetime({ offset: true }).optional(),
  until: z.string().datetime({ offset: true }).optional(),
  sort: z.enum(["createdAt", "updatedAt"]).optional(),
  order: z.enum(["asc", "desc"]).optional(),
  cursor: z.string().min(1).max(2000).optional()
});

const cancelJobSchema = z.object({
  reason: z.string().max(500).optional(),
  requesterId: z.string().max(200).optional()
});

const listExperiencesQuerySchema = z.object({
  status: z.enum(EXPERIENCE_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional()
});

const defaultCorsOrigins = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:5174",
  "http://127.0.0.1:5174",
  "tauri://localhost"
];

function getCorsOrigins() {
  return (process.env.ORCHESTRATOR_CORS_ORIGINS ?? defaultCorsOrigins.join(","))
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function requireAdminToken(request: express.Request, response: express.Response) {
  const expectedToken = process.env.ADMIN_API_TOKEN?.trim();
  if (!expectedToken) {
    response.status(403).json({ error: "admin_api_token_not_configured" });
    return false;
  }

  const actualToken = request.header("x-admin-token")?.trim();
  if (!actualToken || !timingSafeEqualString(actualToken, expectedToken)) {
    response.status(401).json({ error: "invalid_admin_token" });
    return false;
  }

  return true;
}

async function respondWithExperienceStatus(
  request: express.Request,
  response: express.Response,
  status: Exclude<ExperienceStatus, "candidate">
) {
  const experienceId = Array.isArray(request.params.experienceId)
    ? request.params.experienceId[0] ?? ""
    : request.params.experienceId;
  const result = await setExperienceStatus(experienceId, status);
  if (!result.experience) {
    response.status(404).json({ error: "experience_not_found" });
    return;
  }

  if (result.changed) {
    await appendJobEvent(
      result.experience.sourceJobId,
      `experience.${status}`,
      {
        experienceId: result.experience.id,
        kind: result.experience.kind,
        scope: result.experience.scope,
        scopeKey: result.experience.scopeKey
      },
      {
        actor: "user"
      }
    );
  }

  response.json(result);
}

async function main() {
  const app = express();
  await launchDbos();
  const port = Number(process.env.ORCHESTRATOR_PORT ?? 3000);
  const host = process.env.ORCHESTRATOR_HOST?.trim() || "127.0.0.1";
  const corsOrigins = getCorsOrigins();

  app.use((request, response, next) => {
    const origin = request.header("origin");
    if (origin && corsOrigins.includes(origin)) {
      response.header("access-control-allow-origin", origin);
      response.header("vary", "Origin");
      response.header("access-control-allow-methods", "GET,POST,PATCH,OPTIONS");
      response.header(
        "access-control-allow-headers",
        "authorization,content-type,x-admin-token,x-honeycomb-token"
      );
    }

    if (request.method === "OPTIONS") {
      response.sendStatus(204);
      return;
    }

    next();
  });

  app.use(requireApiToken);
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_request, response) => {
    response.json({ ok: true });
  });

  for (const adapter of ingressAdapters) {
    if (adapter.isEnabled(process.env)) {
      adapter.mount(app, {
        createJob,
        getJobByFeishuMessageId,
        startJobWorkflow
      });
    }
  }

  app.post("/admin/model-calls/failed-unknown-outcome", async (request, response, next) => {
    try {
      if (!requireAdminToken(request, response)) {
        return;
      }

      const input = unstickModelCallSchema.parse(request.body);
      const job = await getJob(input.jobId);
      if (!job) {
        response.status(404).json({ error: "job_not_found" });
        return;
      }

      const modelCall = await markModelCallFailedUnknownOutcome({
        idempotencyKey: input.idempotencyKey,
        error: input.reason
          ? `failed_unknown_outcome: ${input.reason}`
          : "failed_unknown_outcome: manually marked by admin"
      });

      if (!modelCall) {
        response.status(404).json({ error: "started_model_call_not_found" });
        return;
      }

      await appendJobEvent(input.jobId, "tool.openclaw_agent_failed_unknown_outcome", {
        modelCallId: modelCall.id,
        idempotencyKey: modelCall.idempotencyKey,
        reason: input.reason ?? null
      }, {
        actor: "admin",
        stageId: modelCall.stageId
      });

      let workflowId: string | null = null;
      if (input.restartWorkflow) {
        const stamp = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
        workflowId = await startJobWorkflow(input.jobId, `job-${input.jobId}-unstick-${stamp}`);
      }

      response.json({
        ok: true,
        modelCallId: modelCall.id,
        status: modelCall.status,
        workflowId
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/jobs", async (request, response, next) => {
    try {
      const query = listJobsQuerySchema.parse(request.query);
      const result = await listJobs(query);
      response.json(result);
    } catch (error) {
      if (error instanceof InvalidJobListCursorError) {
        response.status(400).json({ error: error.message });
        return;
      }

      next(error);
    }
  });

  app.get("/runtime/logs", async (request, response, next) => {
    try {
      const query = runtimeLogsQuerySchema.parse(request.query);
      response.json(await listRuntimeLogs(query));
    } catch (error) {
      next(error);
    }
  });

  app.get("/runtime/usage", async (request, response, next) => {
    try {
      const query = runtimeUsageQuerySchema.parse(request.query);
      response.json(await getRuntimeUsage(query));
    } catch (error) {
      next(error);
    }
  });

  app.get("/runtime/capabilities", (_request, response) => {
    response.json(getRuntimeCapabilities());
  });

  app.get("/runtime/diagnostics", async (request, response, next) => {
    try {
      const query = runtimeDiagnosticsQuerySchema.parse(request.query);
      response.json(await getRuntimeDiagnostics(query));
    } catch (error) {
      next(error);
    }
  });

  app.get("/openclaw/runtime", async (request, response, next) => {
    try {
      const query = openClawRuntimeQuerySchema.parse(request.query);
      response.json(await discoverOpenClawRuntime(query.rootPath));
    } catch (error) {
      next(error);
    }
  });

  app.get("/openclaw/runtime/control", async (request, response, next) => {
    try {
      const query = openClawRuntimeQuerySchema.parse(request.query);
      response.json(await getOpenClawRuntimeControlStatus(query));
    } catch (error) {
      next(error);
    }
  });

  app.post("/openclaw/runtime/:action", async (request, response, next) => {
    try {
      const params = openClawRuntimeActionSchema.parse(request.params);
      const input = openClawRuntimeCommandSchema.parse(request.body ?? {});
      const result = await runOpenClawRuntimeCommand(
        params.action as OpenClawRuntimeAction,
        input
      );
      if (!result.configured) {
        response.status(501).json(result);
        return;
      }
      response.status(result.ok ? 200 : 500).json(result);
    } catch (error) {
      next(error);
    }
  });

  app.post("/openclaw/sync/plan", async (request, response, next) => {
    try {
      const input = openClawSyncSchema.parse(request.body ?? {});
      const plan = await buildOpenClawSyncPlan(input);
      if (!plan) {
        response.status(404).json({ error: "openclaw_runtime_not_found" });
        return;
      }
      response.json(plan);
    } catch (error) {
      next(error);
    }
  });

  app.post("/openclaw/sync/apply", async (request, response, next) => {
    try {
      const input = openClawSyncSchema.parse(request.body ?? {});
      const result = await applyOpenClawSyncPlan(input);
      if (!result) {
        response.status(404).json({ error: "openclaw_runtime_not_found" });
        return;
      }

      await Promise.all(
        result.plan.agents.map((agent) =>
          patchAgentConfig(agent.honeycombAgentId, {
            openclawSyncStatus: agent.status === "ready" ? "synced" : "failed",
            openclawAgentPath: agent.targetAgentPromptPath,
            lastSyncedAt: result.appliedAt,
            lastError: agent.status === "ready" ? null : "missing_template"
          })
        )
      );

      response.json(result);
    } catch (error) {
      next(error);
    }
  });

  app.post("/openclaw/sync/validate", async (request, response, next) => {
    try {
      const input = openClawSyncSchema.parse(request.body ?? {});
      const result = await validateOpenClawSync(input);
      if (!result) {
        response.status(404).json({ error: "openclaw_runtime_not_found" });
        return;
      }
      response.json(result);
    } catch (error) {
      next(error);
    }
  });

  app.get("/providers", async (_request, response, next) => {
    try {
      const providers = await withLiveProviderSecretStatuses(await listModelProviders());
      response.json({ providers });
    } catch (error) {
      next(error);
    }
  });

  app.post("/providers", async (request, response, next) => {
    try {
      const input = providerSchema.parse(request.body ?? {});
      const providerId = input.id?.trim() || stableIdFromName("provider", input.displayName);
      const keyStatus = input.apiKey
        ? await saveProviderApiKey(providerId, input.apiKey)
        : { configured: false, fingerprint: null };
      let verificationStatus: "unknown" | "succeeded" | "failed" = "unknown";
      let lastVerifiedAt: string | null = null;
      let lastError: string | null = null;
      let metadata = input.metadata ?? {};

      if (input.verify) {
        const apiKey = input.apiKey ?? await readProviderApiKey(providerId);
        const model = input.defaultModel;
        if (!apiKey || !model) {
          response.status(400).json({ error: "provider_api_key_and_model_required_for_verify" });
          return;
        }
        const verification = await verifyOpenAiCompatibleProvider({
          baseUrl: input.baseUrl,
          model,
          apiKey
        });
        verificationStatus = verification.status;
        lastVerifiedAt = verification.checkedAt;
        lastError = verification.message;
        metadata = withProviderVerificationMetadata(metadata, verification, model);
      }

      const provider = await upsertModelProvider({
        id: providerId,
        displayName: input.displayName,
        baseUrl: input.baseUrl,
        defaultModel: input.defaultModel,
        apiKeyConfigured: keyStatus.configured,
        apiKeyFingerprint: keyStatus.fingerprint,
        verificationStatus,
        lastVerifiedAt,
        lastError,
        metadata
      });
      response.status(201).json(provider);
    } catch (error) {
      next(error);
    }
  });

  app.patch("/providers/:providerId", async (request, response, next) => {
    try {
      const current = await getModelProvider(request.params.providerId);
      if (!current) {
        response.status(404).json({ error: "provider_not_found" });
        return;
      }
      const input = patchProviderSchema.parse(request.body ?? {});
      const keyStatus = input.apiKey
        ? await saveProviderApiKey(current.id, input.apiKey)
        : await getProviderApiKeyStatus(current.id);
      const patched = await patchModelProvider(current.id, {
        displayName: input.displayName,
        baseUrl: input.baseUrl,
        defaultModel: input.defaultModel,
        apiKeyConfigured: input.apiKey ? true : keyStatus.configured,
        apiKeyFingerprint: input.apiKey
          ? fingerprintSecret(input.apiKey)
          : keyStatus.fingerprint,
        verificationStatus: input.verificationStatus,
        lastError: input.lastError,
        metadata: input.metadata
      });
      response.json(patched);
    } catch (error) {
      next(error);
    }
  });

  app.post("/providers/verify-batch", async (request, response, next) => {
    try {
      const input = verifyProvidersBatchSchema.parse(request.body ?? {});
      const requestedProviders: ProviderVerificationRequest[] =
        input.providers ??
        input.providerIds?.map((providerId): ProviderVerificationRequest => ({ providerId })) ??
        (await listModelProviders()).map((provider): ProviderVerificationRequest => ({
          providerId: provider.id
        }));

      const results = await Promise.all(
        requestedProviders.map(async (requestedProvider) => {
          const currentProvider = await getModelProvider(requestedProvider.providerId);
          if (!currentProvider) {
            return {
              providerId: requestedProvider.providerId,
              provider: null,
              model: requestedProvider.model ?? null,
              verification: providerVerificationFailure("provider_not_found")
            };
          }

          const provider = requestedProvider.apiKey
            ? currentProvider
            : await withLiveProviderSecretStatus(currentProvider);
          if (requestedProvider.apiKey) {
            await saveProviderApiKey(provider.id, requestedProvider.apiKey);
          }

          const apiKey = requestedProvider.apiKey ?? await readProviderApiKey(provider.id);
          const model = requestedProvider.model ?? provider.defaultModel;
          const verification =
            apiKey && model
              ? await verifyOpenAiCompatibleProvider({
                baseUrl: provider.baseUrl,
                model,
                apiKey,
                timeoutMs: input.timeoutMs
              })
              : providerVerificationFailure("provider_api_key_and_model_required_for_verify");
          const patched = await patchModelProvider(provider.id, {
            apiKeyConfigured: Boolean(apiKey),
            apiKeyFingerprint: apiKey
              ? fingerprintSecret(apiKey)
              : null,
            verificationStatus: verification.status,
            lastVerifiedAt: verification.checkedAt,
            lastError: verification.message,
            metadata: withProviderVerificationMetadata(provider.metadata, verification, model ?? null)
          });

          return {
            providerId: provider.id,
            provider: patched,
            model: model ?? null,
            verification
          };
        })
      );

      response.json({
        checkedAt: new Date().toISOString(),
        count: results.length,
        succeeded: results.filter((result) => result.verification.ok).length,
        failed: results.filter((result) => !result.verification.ok).length,
        results
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/providers/:providerId/verify", async (request, response, next) => {
    try {
      const provider = await getModelProvider(request.params.providerId);
      if (!provider) {
        response.status(404).json({ error: "provider_not_found" });
        return;
      }
      const input = verifyProviderSchema.parse(request.body ?? {});
      const currentProvider = input.apiKey ? provider : await withLiveProviderSecretStatus(provider);
      const apiKey = input.apiKey ?? await readProviderApiKey(currentProvider.id);
      const model = input.model ?? provider.defaultModel;
      if (!apiKey || !model) {
        response.status(400).json({ error: "provider_api_key_and_model_required_for_verify" });
        return;
      }

      if (input.apiKey) {
        await saveProviderApiKey(provider.id, input.apiKey);
      }

      const verification = await verifyOpenAiCompatibleProvider({
        baseUrl: provider.baseUrl,
        model,
        apiKey
      });
      const patched = await patchModelProvider(provider.id, {
        apiKeyConfigured: true,
        apiKeyFingerprint: fingerprintSecret(apiKey),
        verificationStatus: verification.status,
        lastVerifiedAt: verification.checkedAt,
        lastError: verification.message,
        metadata: withProviderVerificationMetadata(provider.metadata, verification, model)
      });
      response.json({
        provider: patched,
        verification
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/agents", async (_request, response, next) => {
    try {
      response.json({ agents: await listAgentConfigs() });
    } catch (error) {
      next(error);
    }
  });

  app.post("/agents/seed-defaults", async (request, response, next) => {
    try {
      const input = seedDefaultAgentsSchema.parse(request.body ?? {});
      const provider = input.providerId ? await getModelProvider(input.providerId) : null;
      if (input.providerId && !provider) {
        response.status(404).json({ error: "provider_not_found" });
        return;
      }
      const keyStatus = provider ? await getProviderApiKeyStatus(provider.id) : null;
      const agents = await seedDefaultAgentConfigs({
        panelAgentName: input.panelAgentName,
        providerId: provider?.id ?? input.providerId,
        model: input.model ?? provider?.defaultModel ?? null,
        apiKeyConfigured: keyStatus?.configured ?? provider?.apiKeyConfigured ?? false,
        apiKeyFingerprint: keyStatus?.fingerprint ?? provider?.apiKeyFingerprint ?? null
      });
      response.status(201).json({ agents });
    } catch (error) {
      next(error);
    }
  });

  app.post("/agents", async (request, response, next) => {
    try {
      const input = agentConfigSchema.parse(request.body ?? {});
      if (input.providerId && !(await getModelProvider(input.providerId))) {
        response.status(404).json({ error: "provider_not_found" });
        return;
      }
      response.status(201).json(await upsertAgentConfig(input));
    } catch (error) {
      next(error);
    }
  });

  app.patch("/agents/:agentId", async (request, response, next) => {
    try {
      const input = patchAgentConfigSchema.parse(request.body ?? {});
      if (input.providerId && !(await getModelProvider(input.providerId))) {
        response.status(404).json({ error: "provider_not_found" });
        return;
      }
      const patched = await patchAgentConfig(request.params.agentId, input);
      if (!patched) {
        response.status(404).json({ error: "agent_not_found" });
        return;
      }
      response.json(patched);
    } catch (error) {
      next(error);
    }
  });

  app.get("/skills", async (_request, response, next) => {
    try {
      response.json({ skills: await listSkills() });
    } catch (error) {
      next(error);
    }
  });

  app.post("/skills", async (request, response, next) => {
    try {
      const input = skillSchema.parse(request.body ?? {});
      response.status(201).json(await upsertSkill(input));
    } catch (error) {
      next(error);
    }
  });

  app.patch("/skills/:skillId", async (request, response, next) => {
    try {
      const input = patchSkillSchema.parse(request.body ?? {});
      const skill = await patchSkill(request.params.skillId, input);
      if (!skill) {
        response.status(404).json({ error: "skill_not_found" });
        return;
      }
      response.json(skill);
    } catch (error) {
      next(error);
    }
  });

  app.get("/mcp-servers", async (_request, response, next) => {
    try {
      response.json({ servers: await listMcpServers() });
    } catch (error) {
      next(error);
    }
  });

  app.post("/mcp-servers", async (request, response, next) => {
    try {
      const input = mcpServerSchema.parse(request.body ?? {});
      const server = await upsertMcpServer(input);
      invalidateMcpSession(server.id);
      response.status(201).json(server);
    } catch (error) {
      next(error);
    }
  });

  app.patch("/mcp-servers/:serverId", async (request, response, next) => {
    try {
      const input = patchMcpServerSchema.parse(request.body ?? {});
      const server = await patchMcpServer(request.params.serverId, input);
      if (!server) {
        response.status(404).json({ error: "mcp_server_not_found" });
        return;
      }
      invalidateMcpSession(server.id);
      response.json(server);
    } catch (error) {
      next(error);
    }
  });

  app.post("/mcp-servers/:serverId/check", async (request, response, next) => {
    try {
      const server = await getMcpServer(request.params.serverId);
      if (!server) {
        response.status(404).json({ error: "mcp_server_not_found" });
        return;
      }
      const check = await checkMcpCommand(server.command);
      const patched = await patchMcpServer(server.id, {
        status: check.status,
        lastCheckedAt: check.checkedAt,
        lastError: check.error,
        config: {
          ...server.config,
          lastCommandCheck: {
            resolvedPath: check.resolvedPath
          }
        }
      });
      response.json({
        server: patched,
        check
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/mcp-policies", async (request, response, next) => {
    try {
      const query = mcpPolicyQuerySchema.parse(request.query);
      response.json({
        policies: await listAgentMcpPolicies(query)
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/mcp-policies", async (request, response, next) => {
    try {
      const input = mcpPolicySchema.parse(request.body ?? {});
      if (!(await getAgentConfig(input.agentId))) {
        response.status(404).json({ error: "agent_not_found" });
        return;
      }
      if (!(await getMcpServer(input.serverId))) {
        response.status(404).json({ error: "mcp_server_not_found" });
        return;
      }
      response.status(201).json(await upsertAgentMcpPolicy(input));
    } catch (error) {
      next(error);
    }
  });

  app.patch("/mcp-policies/:policyId", async (request, response, next) => {
    try {
      const input = patchMcpPolicySchema.parse(request.body ?? {});
      const policy = await patchAgentMcpPolicy(request.params.policyId, input);
      if (!policy) {
        response.status(404).json({ error: "mcp_policy_not_found" });
        return;
      }
      response.json(policy);
    } catch (error) {
      next(error);
    }
  });

  app.post("/mcp-servers/:serverId/tools/list", async (request, response, next) => {
    try {
      const input = mcpListSchema.parse(request.body ?? {});
      const server = await getMcpServer(request.params.serverId);
      if (!server) {
        response.status(404).json({ error: "mcp_server_not_found" });
        return;
      }

      const expectedTarget = formatMcpListTarget(server.id, "tools/list");
      const expectedCommand = formatMcpListCommand(server, "tools/list");
      const approval = await getToolApproval(input.approvalId);

      if (!approval) {
        response.status(404).json({ error: "approval_not_found" });
        return;
      }

      if (approval.status !== "approved") {
        response.status(409).json({
          error: "approval_not_approved",
          approval
        });
        return;
      }

      if (!MCP_LIST_TOOL_NAMES.has(approval.toolName) || !MCP_LIST_ACTION_TYPES.has(approval.actionType)) {
        response.status(409).json({
          error: "approval_not_for_mcp_list",
          approval
        });
        return;
      }

      if (approval.target !== expectedTarget) {
        response.status(409).json({
          error: "approval_target_mismatch",
          expected: expectedTarget,
          actual: approval.target,
          approval
        });
        return;
      }

      const approvalCommand = normalizeApprovalCommand(approval.command);
      if (approvalCommand && approvalCommand !== expectedCommand) {
        response.status(409).json({
          error: "approval_command_mismatch",
          expected: expectedCommand,
          actual: approvalCommand,
          approval
        });
        return;
      }

      const policy = await requireMcpPolicy({
        agentId: approval.agentId,
        serverId: server.id,
        operation: "tools/list"
      });

      const consumed = await consumeToolApproval({
        approvalId: approval.id,
        consumedBy: "mcp.tools/list"
      });
      if (!consumed.changed || !consumed.approval) {
        response.status(409).json({
          error: "approval_not_consumable",
          reason: consumed.reason,
          approval: consumed.approval
        });
        return;
      }

      const result = await runMcpToolsList({
        server,
        cursor: input.cursor,
        timeoutMs: input.timeoutMs,
        maxOutputBytes: input.maxOutputBytes
      });
      const patched = await patchMcpServer(server.id, {
        status: "available",
        lastCheckedAt: new Date().toISOString(),
        lastError: null,
        config: {
          ...server.config,
          lastToolsList: mcpDiscoveryConfigEntry(result.result)
        }
      });

      await appendJobEvent(
        approval.jobId,
        "tool.mcp_tools_list_completed",
        {
          approvalId: approval.id,
          policyId: policy.id,
          serverId: server.id,
          serverName: server.name,
          resultPreview: previewJson(result.result),
          stderrPreview: result.stderr.slice(0, 4000),
          durationMs: result.durationMs,
          session: result.session
        },
        {
          actor: "mcp.tools/list",
          stageId: approval.stageId
        }
      );

      response.json({
        approval: consumed.approval,
        server: patched,
        list: result
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/mcp-servers/:serverId/resources/list", async (request, response, next) => {
    try {
      const input = mcpListSchema.parse(request.body ?? {});
      const server = await getMcpServer(request.params.serverId);
      if (!server) {
        response.status(404).json({ error: "mcp_server_not_found" });
        return;
      }

      const expectedTarget = formatMcpListTarget(server.id, "resources/list");
      const expectedCommand = formatMcpListCommand(server, "resources/list");
      const approval = await getToolApproval(input.approvalId);

      if (!approval) {
        response.status(404).json({ error: "approval_not_found" });
        return;
      }

      if (approval.status !== "approved") {
        response.status(409).json({
          error: "approval_not_approved",
          approval
        });
        return;
      }

      if (!MCP_LIST_TOOL_NAMES.has(approval.toolName) || !MCP_LIST_ACTION_TYPES.has(approval.actionType)) {
        response.status(409).json({
          error: "approval_not_for_mcp_list",
          approval
        });
        return;
      }

      if (approval.target !== expectedTarget) {
        response.status(409).json({
          error: "approval_target_mismatch",
          expected: expectedTarget,
          actual: approval.target,
          approval
        });
        return;
      }

      const approvalCommand = normalizeApprovalCommand(approval.command);
      if (approvalCommand && approvalCommand !== expectedCommand) {
        response.status(409).json({
          error: "approval_command_mismatch",
          expected: expectedCommand,
          actual: approvalCommand,
          approval
        });
        return;
      }

      const policy = await requireMcpPolicy({
        agentId: approval.agentId,
        serverId: server.id,
        operation: "resources/list"
      });

      const consumed = await consumeToolApproval({
        approvalId: approval.id,
        consumedBy: "mcp.resources/list"
      });
      if (!consumed.changed || !consumed.approval) {
        response.status(409).json({
          error: "approval_not_consumable",
          reason: consumed.reason,
          approval: consumed.approval
        });
        return;
      }

      const result = await runMcpResourcesList({
        server,
        cursor: input.cursor,
        timeoutMs: input.timeoutMs,
        maxOutputBytes: input.maxOutputBytes
      });
      const patched = await patchMcpServer(server.id, {
        status: "available",
        lastCheckedAt: new Date().toISOString(),
        lastError: null,
        config: {
          ...server.config,
          lastResourcesList: mcpDiscoveryConfigEntry(result.result)
        }
      });

      await appendJobEvent(
        approval.jobId,
        "tool.mcp_resources_list_completed",
        {
          approvalId: approval.id,
          policyId: policy.id,
          serverId: server.id,
          serverName: server.name,
          resultPreview: previewJson(result.result),
          stderrPreview: result.stderr.slice(0, 4000),
          durationMs: result.durationMs,
          session: result.session
        },
        {
          actor: "mcp.resources/list",
          stageId: approval.stageId
        }
      );

      response.json({
        approval: consumed.approval,
        server: patched,
        list: result
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/mcp-servers/:serverId/tools/call", async (request, response, next) => {
    try {
      const input = mcpToolCallSchema.parse(request.body ?? {});
      const server = await getMcpServer(request.params.serverId);
      if (!server) {
        response.status(404).json({ error: "mcp_server_not_found" });
        return;
      }

      const expectedTarget = formatMcpToolTarget(server.id, input.toolName);
      const expectedCommand = formatMcpToolCommand(server, input.toolName);
      const approval = await getToolApproval(input.approvalId);

      if (!approval) {
        response.status(404).json({ error: "approval_not_found" });
        return;
      }

      if (approval.status !== "approved") {
        response.status(409).json({
          error: "approval_not_approved",
          approval
        });
        return;
      }

      if (
        !MCP_TOOL_CALL_TOOL_NAMES.has(approval.toolName) ||
        !MCP_TOOL_CALL_ACTION_TYPES.has(approval.actionType)
      ) {
        response.status(409).json({
          error: "approval_not_for_mcp_tool_call",
          approval
        });
        return;
      }

      if (approval.target !== expectedTarget) {
        response.status(409).json({
          error: "approval_target_mismatch",
          expected: expectedTarget,
          actual: approval.target,
          approval
        });
        return;
      }

      const approvalCommand = normalizeApprovalCommand(approval.command);
      if (approvalCommand && approvalCommand !== expectedCommand) {
        response.status(409).json({
          error: "approval_command_mismatch",
          expected: expectedCommand,
          actual: approvalCommand,
          approval
        });
        return;
      }

      const policy = await requireMcpPolicy({
        agentId: approval.agentId,
        serverId: server.id,
        operation: "tools/call",
        toolName: input.toolName
      });

      const consumed = await consumeToolApproval({
        approvalId: approval.id,
        consumedBy: "mcp.tools/call"
      });
      if (!consumed.changed || !consumed.approval) {
        response.status(409).json({
          error: "approval_not_consumable",
          reason: consumed.reason,
          approval: consumed.approval
        });
        return;
      }

      const result = await runMcpToolCall({
        server,
        toolName: input.toolName,
        arguments: input.arguments,
        timeoutMs: input.timeoutMs,
        maxOutputBytes: input.maxOutputBytes
      });

      await appendJobEvent(
        approval.jobId,
        "tool.mcp_call_completed",
        {
          approvalId: approval.id,
          policyId: policy.id,
          serverId: server.id,
          serverName: server.name,
          toolName: input.toolName,
          displayCommand: result.displayCommand,
          resultPreview: JSON.stringify(result.result).slice(0, 4000),
          stderrPreview: result.stderr.slice(0, 4000),
          durationMs: result.durationMs,
          session: result.session
        },
        {
          actor: "mcp.tools/call",
          stageId: approval.stageId
        }
      );

      response.json({
        approval: consumed.approval,
        call: result
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/schedules", async (request, response, next) => {
    try {
      const query = listSchedulesQuerySchema.parse(request.query);
      response.json(await listScheduledTasks(query));
    } catch (error) {
      next(error);
    }
  });

  app.get("/schedules/due", async (request, response, next) => {
    try {
      const query = dueSchedulesQuerySchema.parse(request.query);
      const now = query.now ? new Date(query.now) : new Date();
      response.json({
        checkedAt: now.toISOString(),
        schedules: await listDueScheduledTasks(now, query.limit)
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/schedules/:scheduleId", async (request, response, next) => {
    try {
      const schedule = await getScheduledTask(request.params.scheduleId);
      if (!schedule) {
        response.status(404).json({ error: "schedule_not_found" });
        return;
      }
      response.json(schedule);
    } catch (error) {
      next(error);
    }
  });

  app.post("/schedules", async (request, response, next) => {
    try {
      const input = scheduleSchema.parse(request.body ?? {});
      if (input.providerId && !(await getModelProvider(input.providerId))) {
        response.status(404).json({ error: "provider_not_found" });
        return;
      }
      if (input.agentId && !(await getAgentConfig(input.agentId))) {
        response.status(404).json({ error: "agent_not_found" });
        return;
      }
      response.status(201).json(await upsertScheduledTask(input));
    } catch (error) {
      next(error);
    }
  });

  app.patch("/schedules/:scheduleId", async (request, response, next) => {
    try {
      const input = patchScheduleSchema.parse(request.body ?? {});
      if (input.providerId && !(await getModelProvider(input.providerId))) {
        response.status(404).json({ error: "provider_not_found" });
        return;
      }
      if (input.agentId && !(await getAgentConfig(input.agentId))) {
        response.status(404).json({ error: "agent_not_found" });
        return;
      }
      const schedule = await patchScheduledTask(request.params.scheduleId, input);
      if (!schedule) {
        response.status(404).json({ error: "schedule_not_found" });
        return;
      }
      response.json(schedule);
    } catch (error) {
      next(error);
    }
  });

  app.post("/schedules/:scheduleId/trigger", async (request, response, next) => {
    try {
      const input = triggerScheduleSchema.parse(request.body ?? {});
      const schedule = await getScheduledTask(request.params.scheduleId);
      if (!schedule) {
        response.status(404).json({ error: "schedule_not_found" });
        return;
      }
      if (!schedule.enabled && !input.force) {
        response.status(409).json({ error: "schedule_disabled", schedule });
        return;
      }

      const job = await createJob({
        rawPrompt: schedule.prompt,
        workdir: schedule.workspacePath ?? undefined,
        ingressOrigin: "http",
        routingMode: schedule.routingMode,
        maxModelCalls: schedule.maxModelCalls,
        requesterId: input.requesterId ?? `schedule:${schedule.id}`
      });
      await appendJobEvent(
        job.id,
        "schedule.triggered",
        {
          scheduleId: schedule.id,
          scheduleType: schedule.scheduleType,
          nextRunAt: schedule.nextRunAt
        },
        {
          actor: "scheduler"
        }
      );

      let workflowId: string | null = null;
      try {
        workflowId = input.startWorkflow ? await startJobWorkflow(job.id) : null;
      } catch (error) {
        await markScheduledTaskTriggered({
          scheduleId: schedule.id,
          jobId: job.id,
          status: "failed",
          error: error instanceof Error ? error.message : String(error)
        });
        throw error;
      }

      const updatedSchedule = await markScheduledTaskTriggered({
        scheduleId: schedule.id,
        jobId: job.id,
        status: input.startWorkflow ? "queued" : "idle"
      });

      response.status(201).json({
        ok: true,
        schedule: updatedSchedule,
        job,
        workflowId
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/workspaces", async (request, response, next) => {
    try {
      const query = listRegisteredWorkspacesQuerySchema.parse(request.query);
      response.json({
        workspaces: await listRegisteredWorkspaces(query)
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/workspaces/register", async (request, response, next) => {
    try {
      const input = workspaceRegisterSchema.parse(request.body ?? {});
      const resolvedRoot = normalizeWorkspaceRootPath(input.rootPath);
      const rootPathKey = workspaceRootKey(resolvedRoot);
      const expectedTarget = workspaceApprovalTarget(rootPathKey);
      const approval = await getToolApproval(input.approvalId);

      if (!approval) {
        response.status(404).json({ error: "approval_not_found" });
        return;
      }

      if (approval.status !== "approved") {
        response.status(409).json({
          error: "approval_not_approved",
          approval
        });
        return;
      }

      if (
        !WORKSPACE_REGISTER_TOOL_NAMES.has(approval.toolName) ||
        !WORKSPACE_REGISTER_ACTION_TYPES.has(approval.actionType)
      ) {
        response.status(409).json({
          error: "approval_not_for_workspace_register",
          approval
        });
        return;
      }

      const approvalTargetKey = normalizeWorkspaceRegistrationTarget(approval.target);
      if (approvalTargetKey !== rootPathKey) {
        response.status(409).json({
          error: "approval_target_mismatch",
          expected: expectedTarget,
          actual: approval.target,
          approval
        });
        return;
      }

      const approvalCommand = normalizeApprovalCommand(approval.command);
      const expectedCommand = `Register workspace ${resolvedRoot}`;
      if (approvalCommand && approvalCommand !== expectedCommand) {
        response.status(409).json({
          error: "approval_command_mismatch",
          expected: expectedCommand,
          actual: approvalCommand,
          approval
        });
        return;
      }

      const target = await resolveWorkspaceDirectoryTarget(resolvedRoot, ".");
      const consumed = await consumeToolApproval({
        approvalId: approval.id,
        consumedBy: "workspace.register"
      });
      if (!consumed.changed || !consumed.approval) {
        response.status(409).json({
          error: "approval_not_consumable",
          reason: consumed.reason,
          approval: consumed.approval
        });
        return;
      }

      const workspace = await upsertRegisteredWorkspace({
        rootPath: target.rootPath,
        rootPathKey: workspaceRootKey(target.rootPath),
        displayName: input.displayName,
        approvalId: approval.id,
        registeredBy: input.registeredBy ?? approval.decidedBy ?? null,
        metadata: input.metadata
      });

      await appendJobEvent(
        approval.jobId,
        "tool.workspace_registered",
        {
          approvalId: approval.id,
          workspaceId: workspace.id,
          rootPath: workspace.rootPath,
          rootPathKey: workspace.rootPathKey
        },
        {
          actor: "workspace.register",
          stageId: approval.stageId
        }
      );

      response.status(201).json({
        approval: consumed.approval,
        workspace
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/workspaces/inspect", async (request, response, next) => {
    try {
      const query = workspaceRootQuerySchema.parse(request.query);
      const rootPath = await requireRegisteredWorkspaceRoot(query.rootPath, response);
      if (!rootPath) {
        return;
      }
      response.json(await inspectWorkspace(rootPath));
    } catch (error) {
      next(error);
    }
  });

  app.get("/workspaces/files", async (request, response, next) => {
    try {
      const query = workspaceFilesQuerySchema.parse(request.query);
      const rootPath = await requireRegisteredWorkspaceRoot(query.rootPath, response);
      if (!rootPath) {
        return;
      }
      response.json(
        await listWorkspaceFiles(rootPath, {
          subpath: query.subpath,
          depth: query.depth,
          limit: query.limit,
          includeHidden: query.includeHidden
        })
      );
    } catch (error) {
      next(error);
    }
  });

  app.get("/workspaces/file", async (request, response, next) => {
    try {
      const query = workspaceFileQuerySchema.parse(request.query);
      const rootPath = await requireRegisteredWorkspaceRoot(query.rootPath, response);
      if (!rootPath) {
        return;
      }
      response.json(
        await readWorkspaceFile(rootPath, {
          subpath: query.subpath,
          maxBytes: query.maxBytes
        })
      );
    } catch (error) {
      next(error);
    }
  });

  app.post("/workspaces/file/write", async (request, response, next) => {
    try {
      const input = workspaceWriteFileSchema.parse(request.body ?? {});
      const rootPath = await requireRegisteredWorkspaceRoot(input.rootPath, response);
      if (!rootPath) {
        return;
      }
      const target = await prepareWorkspaceFileWrite(rootPath, {
        subpath: input.subpath,
        mode: input.mode,
        createParents: input.createParents
      });
      const approval = await getToolApproval(input.approvalId);

      if (!approval) {
        response.status(404).json({ error: "approval_not_found" });
        return;
      }

      if (approval.status !== "approved") {
        response.status(409).json({
          error: "approval_not_approved",
          approval
        });
        return;
      }

      if (
        !WORKSPACE_WRITE_TOOL_NAMES.has(approval.toolName) ||
        !WORKSPACE_WRITE_ACTION_TYPES.has(approval.actionType)
      ) {
        response.status(409).json({
          error: "approval_not_for_workspace_write",
          approval
        });
        return;
      }

      const approvalTarget = normalizeApprovalTarget(approval.target);
      if (approvalTarget !== target.relativePath) {
        response.status(409).json({
          error: "approval_target_mismatch",
          expected: target.relativePath,
          actual: approvalTarget,
          approval
        });
        return;
      }

      const consumed = await consumeToolApproval({
        approvalId: approval.id,
        consumedBy: "workspace.writeFile"
      });
      if (!consumed.changed || !consumed.approval) {
        response.status(409).json({
          error: "approval_not_consumable",
          reason: consumed.reason,
          approval: consumed.approval
        });
        return;
      }

      const result = await writeWorkspaceFile(rootPath, {
        subpath: input.subpath,
        content: input.content,
        mode: input.mode,
        createParents: input.createParents
      });

      await appendJobEvent(
        approval.jobId,
        "tool.workspace_file_written",
        {
          approvalId: approval.id,
          rootPath: result.rootPath,
          relativePath: result.relativePath,
          mode: result.mode,
          bytes: result.bytes,
          size: result.size
        },
        {
          actor: "workspace.writeFile",
          stageId: approval.stageId
        }
      );

      response.status(201).json({
        approval: consumed.approval,
        file: result
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/workspaces/command/run", async (request, response, next) => {
    try {
      const input = workspaceCommandRunSchema.parse(request.body ?? {});
      const rootPath = await requireRegisteredWorkspaceRoot(input.rootPath, response);
      if (!rootPath) {
        return;
      }
      const cwd = await resolveWorkspaceDirectoryTarget(rootPath, input.cwdSubpath ?? ".");
      const expectedTarget = cwd.relativePath || ".";
      const args = input.args ?? [];
      const displayCommand = formatWorkspaceCommand(input.command, args);
      const approval = await getToolApproval(input.approvalId);

      if (!approval) {
        response.status(404).json({ error: "approval_not_found" });
        return;
      }

      if (approval.status !== "approved") {
        response.status(409).json({
          error: "approval_not_approved",
          approval
        });
        return;
      }

      if (
        !WORKSPACE_COMMAND_TOOL_NAMES.has(approval.toolName) ||
        !WORKSPACE_COMMAND_ACTION_TYPES.has(approval.actionType)
      ) {
        response.status(409).json({
          error: "approval_not_for_workspace_command",
          approval
        });
        return;
      }

      const approvalTarget = normalizeApprovalTarget(approval.target);
      if (approvalTarget !== expectedTarget) {
        response.status(409).json({
          error: "approval_target_mismatch",
          expected: expectedTarget,
          actual: approvalTarget,
          approval
        });
        return;
      }

      const approvalCommand = normalizeApprovalCommand(approval.command);
      if (approvalCommand !== displayCommand) {
        response.status(409).json({
          error: "approval_command_mismatch",
          expected: displayCommand,
          actual: approvalCommand,
          approval
        });
        return;
      }

      const consumed = await consumeToolApproval({
        approvalId: approval.id,
        consumedBy: "workspace.runCommand"
      });
      if (!consumed.changed || !consumed.approval) {
        response.status(409).json({
          error: "approval_not_consumable",
          reason: consumed.reason,
          approval: consumed.approval
        });
        return;
      }

      const result = await runWorkspaceCommand(rootPath, {
        cwdSubpath: input.cwdSubpath,
        command: input.command,
        args,
        timeoutMs: input.timeoutMs,
        maxOutputBytes: input.maxOutputBytes
      });

      await appendJobEvent(
        approval.jobId,
        "tool.workspace_command_completed",
        {
          approvalId: approval.id,
          cwdRelativePath: result.cwdRelativePath || ".",
          displayCommand: result.displayCommand,
          exitCode: result.exitCode,
          signal: result.signal,
          timedOut: result.timedOut,
          durationMs: result.durationMs,
          stdoutPreview: result.stdout.slice(0, 4000),
          stderrPreview: result.stderr.slice(0, 4000),
          stdoutTruncated: result.stdoutTruncated,
          stderrTruncated: result.stderrTruncated
        },
        {
          actor: "workspace.runCommand",
          stageId: approval.stageId
        }
      );

      response.json({
        approval: consumed.approval,
        command: result
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/tools/web/fetch", async (request, response, next) => {
    try {
      const input = webFetchRunSchema.parse(request.body ?? {});
      const normalizedUrl = normalizeWebFetchUrl(input.url);
      const displayCommand = formatWebFetchCommand(normalizedUrl);
      const approval = await getToolApproval(input.approvalId);

      if (!approval) {
        response.status(404).json({ error: "approval_not_found" });
        return;
      }

      if (approval.status !== "approved") {
        response.status(409).json({
          error: "approval_not_approved",
          approval
        });
        return;
      }

      if (!WEB_FETCH_TOOL_NAMES.has(approval.toolName) || !WEB_FETCH_ACTION_TYPES.has(approval.actionType)) {
        response.status(409).json({
          error: "approval_not_for_web_fetch",
          approval
        });
        return;
      }

      const approvalTarget = approval.target ? normalizeWebFetchUrl(approval.target) : null;
      if (approvalTarget !== normalizedUrl) {
        response.status(409).json({
          error: "approval_target_mismatch",
          expected: normalizedUrl,
          actual: approvalTarget,
          approval
        });
        return;
      }

      const approvalCommand = normalizeApprovalCommand(approval.command);
      if (approvalCommand && approvalCommand !== displayCommand) {
        response.status(409).json({
          error: "approval_command_mismatch",
          expected: displayCommand,
          actual: approvalCommand,
          approval
        });
        return;
      }

      const allowPrivateNetwork = input.allowPrivateNetwork === true;
      if (
        allowPrivateNetwork &&
        !approvalFlag(approval.policy, "allowPrivateNetwork") &&
        !approvalFlag(approval.input, "allowPrivateNetwork")
      ) {
        response.status(409).json({
          error: "private_network_not_approved",
          approval
        });
        return;
      }

      if (
        !(await requireAgentNetworkPolicy({
          approval,
          operation: "web.fetch",
          url: normalizedUrl,
          allowPrivateNetwork,
          response
        }))
      ) {
        return;
      }

      const consumed = await consumeToolApproval({
        approvalId: approval.id,
        consumedBy: "web.fetch"
      });
      if (!consumed.changed || !consumed.approval) {
        response.status(409).json({
          error: "approval_not_consumable",
          reason: consumed.reason,
          approval: consumed.approval
        });
        return;
      }

      const result = await runWebFetch({
        url: normalizedUrl,
        timeoutMs: input.timeoutMs,
        maxBytes: input.maxBytes,
        allowPrivateNetwork
      });

      await appendJobEvent(
        approval.jobId,
        "tool.web_fetch_completed",
        {
          approvalId: approval.id,
          url: result.url,
          finalUrl: result.finalUrl,
          statusCode: result.statusCode,
          ok: result.ok,
          contentType: result.contentType,
          byteLength: result.byteLength,
          truncated: result.truncated,
          durationMs: result.durationMs,
          bodyPreview: result.bodyText.slice(0, 4000)
        },
        {
          actor: "web.fetch",
          stageId: approval.stageId
        }
      );

      response.json({
        approval: consumed.approval,
        fetch: result
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/tools/web/search", async (request, response, next) => {
    try {
      const input = webSearchRunSchema.parse(request.body ?? {});
      const searchUrl = buildWebSearchUrl(input.query, input.endpointUrl);
      const displayCommand = formatWebSearchCommand(input.query, input.endpointUrl);
      const approval = await getToolApproval(input.approvalId);

      if (!approval) {
        response.status(404).json({ error: "approval_not_found" });
        return;
      }

      if (approval.status !== "approved") {
        response.status(409).json({
          error: "approval_not_approved",
          approval
        });
        return;
      }

      if (!WEB_SEARCH_TOOL_NAMES.has(approval.toolName) || !WEB_SEARCH_ACTION_TYPES.has(approval.actionType)) {
        response.status(409).json({
          error: "approval_not_for_web_search",
          approval
        });
        return;
      }

      const approvalTarget = approval.target ? normalizeWebFetchUrl(approval.target) : null;
      if (approvalTarget !== searchUrl) {
        response.status(409).json({
          error: "approval_target_mismatch",
          expected: searchUrl,
          actual: approvalTarget,
          approval
        });
        return;
      }

      const approvalCommand = normalizeApprovalCommand(approval.command);
      if (approvalCommand && approvalCommand !== displayCommand) {
        response.status(409).json({
          error: "approval_command_mismatch",
          expected: displayCommand,
          actual: approvalCommand,
          approval
        });
        return;
      }

      const allowPrivateNetwork = input.allowPrivateNetwork === true;
      if (
        allowPrivateNetwork &&
        !approvalFlag(approval.policy, "allowPrivateNetwork") &&
        !approvalFlag(approval.input, "allowPrivateNetwork")
      ) {
        response.status(409).json({
          error: "private_network_not_approved",
          approval
        });
        return;
      }

      if (
        !(await requireAgentNetworkPolicy({
          approval,
          operation: "web.search",
          url: searchUrl,
          allowPrivateNetwork,
          response
        }))
      ) {
        return;
      }

      const consumed = await consumeToolApproval({
        approvalId: approval.id,
        consumedBy: "web.search"
      });
      if (!consumed.changed || !consumed.approval) {
        response.status(409).json({
          error: "approval_not_consumable",
          reason: consumed.reason,
          approval: consumed.approval
        });
        return;
      }

      const result = await runWebSearch({
        query: input.query,
        endpointUrl: input.endpointUrl,
        timeoutMs: input.timeoutMs,
        maxBytes: input.maxBytes,
        maxResults: input.maxResults,
        allowPrivateNetwork
      });

      await appendJobEvent(
        approval.jobId,
        "tool.web_search_completed",
        {
          approvalId: approval.id,
          query: result.query,
          searchUrl: result.searchUrl,
          resultCount: result.results.length,
          durationMs: result.fetch.durationMs
        },
        {
          actor: "web.search",
          stageId: approval.stageId
        }
      );

      response.json({
        approval: consumed.approval,
        search: result
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/tools/browser/snapshot", async (request, response, next) => {
    try {
      const input = browserSnapshotRunSchema.parse(request.body ?? {});
      const normalizedUrl = normalizeWebFetchUrl(input.url);
      const displayCommand = formatBrowserSnapshotCommand(normalizedUrl);
      const approval = await getToolApproval(input.approvalId);

      if (!approval) {
        response.status(404).json({ error: "approval_not_found" });
        return;
      }

      if (approval.status !== "approved") {
        response.status(409).json({
          error: "approval_not_approved",
          approval
        });
        return;
      }

      if (
        !BROWSER_SNAPSHOT_TOOL_NAMES.has(approval.toolName) ||
        !BROWSER_SNAPSHOT_ACTION_TYPES.has(approval.actionType)
      ) {
        response.status(409).json({
          error: "approval_not_for_browser_snapshot",
          approval
        });
        return;
      }

      const approvalTarget = approval.target ? normalizeWebFetchUrl(approval.target) : null;
      if (approvalTarget !== normalizedUrl) {
        response.status(409).json({
          error: "approval_target_mismatch",
          expected: normalizedUrl,
          actual: approvalTarget,
          approval
        });
        return;
      }

      const approvalCommand = normalizeApprovalCommand(approval.command);
      if (approvalCommand && approvalCommand !== displayCommand) {
        response.status(409).json({
          error: "approval_command_mismatch",
          expected: displayCommand,
          actual: approvalCommand,
          approval
        });
        return;
      }

      const allowPrivateNetwork = input.allowPrivateNetwork === true;
      if (
        allowPrivateNetwork &&
        !approvalFlag(approval.policy, "allowPrivateNetwork") &&
        !approvalFlag(approval.input, "allowPrivateNetwork")
      ) {
        response.status(409).json({
          error: "private_network_not_approved",
          approval
        });
        return;
      }

      if (
        !(await requireAgentNetworkPolicy({
          approval,
          operation: "browser.snapshot",
          url: normalizedUrl,
          allowPrivateNetwork,
          response
        }))
      ) {
        return;
      }

      const consumed = await consumeToolApproval({
        approvalId: approval.id,
        consumedBy: "browser.snapshot"
      });
      if (!consumed.changed || !consumed.approval) {
        response.status(409).json({
          error: "approval_not_consumable",
          reason: consumed.reason,
          approval: consumed.approval
        });
        return;
      }

      const result = await runBrowserSnapshot({
        url: normalizedUrl,
        timeoutMs: input.timeoutMs,
        maxBytes: input.maxBytes,
        maxLinks: input.maxLinks,
        allowPrivateNetwork
      });

      await appendJobEvent(
        approval.jobId,
        "tool.browser_snapshot_completed",
        {
          approvalId: approval.id,
          url: result.url,
          finalUrl: result.finalUrl,
          title: result.title,
          linkCount: result.links.length,
          durationMs: result.fetch.durationMs
        },
        {
          actor: "browser.snapshot",
          stageId: approval.stageId
        }
      );

      response.json({
        approval: consumed.approval,
        snapshot: result
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/workspaces/git/status", async (request, response, next) => {
    try {
      const query = workspaceRootQuerySchema.parse(request.query);
      const rootPath = await requireRegisteredWorkspaceRoot(query.rootPath, response);
      if (!rootPath) {
        return;
      }
      response.json(await getWorkspaceGitStatus(rootPath));
    } catch (error) {
      next(error);
    }
  });

  app.get("/approvals", async (request, response, next) => {
    try {
      await expirePendingToolApprovals();
      const query = listApprovalsQuerySchema.parse(request.query);
      response.json(await listToolApprovals(query));
    } catch (error) {
      next(error);
    }
  });

  app.post("/approvals", async (request, response, next) => {
    try {
      const input = createApprovalSchema.parse(request.body ?? {});
      const approval = await createToolApprovalRequest(input);
      if (!approval) {
        response.status(404).json({ error: "job_or_session_not_found" });
        return;
      }
      response.status(201).json(approval);
    } catch (error) {
      next(error);
    }
  });

  app.get("/approvals/:approvalId", async (request, response, next) => {
    try {
      await expirePendingToolApprovals();
      const approval = await getToolApproval(request.params.approvalId);
      if (!approval) {
        response.status(404).json({ error: "approval_not_found" });
        return;
      }
      response.json(approval);
    } catch (error) {
      next(error);
    }
  });

  async function respondWithApprovalDecision(
    request: express.Request,
    response: express.Response,
    status: "approved" | "rejected" | "cancelled"
  ) {
    const input = decideApprovalSchema.parse(request.body ?? {});
    const approvalId = String(request.params.approvalId ?? "");
    const result = await decideToolApproval({
      approvalId,
      status,
      decidedBy: "desktop-app",
      decisionReason: input.decisionReason
    });

    if (!result.approval) {
      response.status(404).json({ error: "approval_not_found" });
      return;
    }

    if (result.reason === "not_pending") {
      response.status(409).json({
        error: "approval_not_pending",
        approval: result.approval
      });
      return;
    }

    if (result.reason === "expired") {
      response.status(409).json({
        error: "approval_expired",
        approval: result.approval
      });
      return;
    }

    response.json(result);
  }

  app.post("/approvals/:approvalId/approve", async (request, response, next) => {
    try {
      await respondWithApprovalDecision(request, response, "approved");
    } catch (error) {
      next(error);
    }
  });

  app.post("/approvals/:approvalId/reject", async (request, response, next) => {
    try {
      await respondWithApprovalDecision(request, response, "rejected");
    } catch (error) {
      next(error);
    }
  });

  app.post("/approvals/:approvalId/cancel", async (request, response, next) => {
    try {
      await respondWithApprovalDecision(request, response, "cancelled");
    } catch (error) {
      next(error);
    }
  });

  app.post("/approvals/:approvalId/consume", async (request, response, next) => {
    try {
      const input = consumeApprovalSchema.parse(request.body ?? {});
      const result = await consumeToolApproval({
        approvalId: request.params.approvalId,
        consumedBy: input.consumedBy ?? "tool-gateway"
      });

      if (!result.approval) {
        response.status(404).json({ error: "approval_not_found" });
        return;
      }

      if (result.reason === "not_approved") {
        response.status(409).json({
          error: "approval_not_approved",
          approval: result.approval
        });
        return;
      }

      if (result.reason === "expired") {
        response.status(409).json({
          error: "approval_expired",
          approval: result.approval
        });
        return;
      }

      response.json(result);
    } catch (error) {
      next(error);
    }
  });

  app.get("/sessions", async (request, response, next) => {
    try {
      const query = listSessionsQuerySchema.parse(request.query);
      response.json(await listSessions(query));
    } catch (error) {
      next(error);
    }
  });

  app.get("/sessions/:sessionId/events", async (request, response, next) => {
    try {
      const query = sessionEventsQuerySchema.parse(request.query);
      response.json(await getSessionEvents(request.params.sessionId, query));
    } catch (error) {
      next(error);
    }
  });

  app.get("/sessions/:sessionId/events/stream", async (request, response, next) => {
    try {
      const query = sessionEventsStreamQuerySchema.parse(request.query);
      const pollMs = query.pollMs ?? 1000;
      const heartbeatMs = query.heartbeatMs ?? 15000;
      const limit = query.limit ?? 100;
      let afterSeq = query.afterSeq ?? 0;
      let closed = false;
      let inFlight = false;

      const initial = await getSessionEventsAfter(request.params.sessionId, {
        afterSeq,
        limit
      });
      if (!initial) {
        response.status(404).json({ error: "session_not_found" });
        return;
      }

      response.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no"
      });
      response.write(`retry: ${Math.max(pollMs, 1000)}\n\n`);

      const writeEvent = (event: string, data: unknown, id?: string | number) => {
        if (closed) {
          return;
        }
        if (id !== undefined) {
          response.write(`id: ${id}\n`);
        }
        response.write(`event: ${event}\n`);
        response.write(`data: ${JSON.stringify(data)}\n\n`);
      };

      writeEvent("ready", {
        sessionId: request.params.sessionId,
        afterSeq,
        pollMs,
        heartbeatMs,
        limit
      });

      const pump = async () => {
        if (closed || inFlight) {
          return;
        }
        inFlight = true;
        try {
          const batch = await getSessionEventsAfter(request.params.sessionId, {
            afterSeq,
            limit
          });
          if (!batch) {
            writeEvent("closed", {
              reason: "session_not_found",
              sessionId: request.params.sessionId
            });
            response.end();
            closed = true;
            return;
          }

          for (const event of batch.events) {
            afterSeq = event.seq;
            writeEvent("session_event", event, event.seq);
          }
        } catch (error) {
          writeEvent("error", {
            message: error instanceof Error ? error.message : "unknown_error"
          });
        } finally {
          inFlight = false;
        }
      };

      await pump();

      const pollTimer = setInterval(() => {
        void pump();
      }, pollMs);
      const heartbeatTimer = setInterval(() => {
        if (!closed) {
          response.write(`: heartbeat ${new Date().toISOString()} seq=${afterSeq}\n\n`);
        }
      }, heartbeatMs);

      request.on("close", () => {
        closed = true;
        clearInterval(pollTimer);
        clearInterval(heartbeatTimer);
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/sessions/:sessionId/archive", async (request, response, next) => {
    try {
      const input = archiveSessionSchema.parse(request.body ?? {});
      const job = await getJobBySessionId(request.params.sessionId);
      if (!job) {
        response.status(404).json({ error: "session_not_found" });
        return;
      }
      const archived = await archiveJobSession({
        jobId: job.id,
        retentionDays: input.retentionDays,
        reason: input.reason ?? "session_archived"
      });
      response.json({
        ok: true,
        changed: !job.archivedAt,
        sessionId: request.params.sessionId,
        job: archived
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/sessions/:sessionId/restore", async (request, response, next) => {
    try {
      const input = restoreSessionSchema.parse(request.body ?? {});
      const job = await restoreJobSession({
        sessionId: request.params.sessionId,
        reason: input.reason ?? "session_restored",
        requesterId: input.requesterId
      });
      if (!job) {
        response.status(404).json({ error: "session_not_found" });
        return;
      }
      response.json({
        ok: true,
        sessionId: request.params.sessionId,
        job
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/sessions/:sessionId/fork", async (request, response, next) => {
    try {
      const input = forkSessionSchema.parse(request.body ?? {});
      const source = await getJobBySessionId(request.params.sessionId);
      if (!source) {
        response.status(404).json({ error: "session_not_found" });
        return;
      }
      const forked = await createJob({
        rawPrompt: input.prompt ?? source.rawPrompt,
        workdir: input.inheritWorkdir ? source.workdir ?? undefined : undefined,
        ingressOrigin: "http",
        routingMode: input.routingMode ?? source.routingMode,
        maxModelCalls: input.maxModelCalls ?? source.maxModelCalls,
        classicFinalGateEnabled: input.classicFinalGateEnabled ?? source.classicFinalGateEnabled,
        discussionRounds: input.discussionRounds ?? source.discussionRounds,
        requesterId: input.requesterId ?? "session-fork"
      });
      await appendJobEvent(forked.id, "session.forked", {
        sourceSessionId: source.sessionId,
        sourceJobId: source.id,
        inheritedWorkdir: input.inheritWorkdir
      }, {
        actor: "session-ledger"
      });
      const workflowId = input.startWorkflow ? await startJobWorkflow(forked.id) : null;
      response.status(201).json({
        ok: true,
        sourceSessionId: source.sessionId,
        sessionId: forked.sessionId,
        job: forked,
        workflowId
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/sessions/:sessionId/compress", async (request, response, next) => {
    try {
      const input = compressSessionSchema.parse(request.body ?? {});
      const result = await compressSession(request.params.sessionId, input);
      if (!result) {
        response.status(404).json({ error: "session_not_found" });
        return;
      }
      response.json({
        ok: true,
        ...result
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/plans", async (request, response, next) => {
    try {
      const query = listPlansQuerySchema.parse(request.query);
      response.json(await listPlans(query));
    } catch (error) {
      next(error);
    }
  });

  app.get("/plans/:planId", async (request, response, next) => {
    try {
      const plan = await getPlan(request.params.planId);
      if (!plan) {
        response.status(404).json({ error: "plan_not_found" });
        return;
      }
      response.json(plan);
    } catch (error) {
      next(error);
    }
  });

  app.patch("/plans/:planId", async (request, response, next) => {
    try {
      const input = updatePlanSchema.parse(request.body ?? {});
      const plan = await updatePlan(request.params.planId, input);
      if (!plan) {
        response.status(404).json({ error: "plan_not_found" });
        return;
      }
      response.json(plan);
    } catch (error) {
      next(error);
    }
  });

  app.post("/plans/:planId/items", async (request, response, next) => {
    try {
      const input = createPlanItemSchema.parse(request.body ?? {});
      const item = await createPlanItem(request.params.planId, input);
      if (!item) {
        response.status(404).json({ error: "plan_not_found" });
        return;
      }
      response.status(201).json(item);
    } catch (error) {
      next(error);
    }
  });

  app.patch("/plans/:planId/items/:itemId", async (request, response, next) => {
    try {
      const input = updatePlanItemSchema.parse(request.body ?? {});
      const item = await updatePlanItem(request.params.planId, request.params.itemId, input);
      if (!item) {
        response.status(404).json({ error: "plan_item_not_found" });
        return;
      }
      response.json(item);
    } catch (error) {
      next(error);
    }
  });

  app.get("/memory/experiences", async (request, response, next) => {
    try {
      const query = listExperiencesQuerySchema.parse(request.query);
      response.json(await listExperiences(query));
    } catch (error) {
      next(error);
    }
  });

  app.post("/memory/experiences/:experienceId/adopt", async (request, response, next) => {
    try {
      await respondWithExperienceStatus(request, response, "adopted");
    } catch (error) {
      next(error);
    }
  });

  app.post("/memory/experiences/:experienceId/reject", async (request, response, next) => {
    try {
      await respondWithExperienceStatus(request, response, "rejected");
    } catch (error) {
      next(error);
    }
  });

  app.get("/jobs/:jobId", async (request, response, next) => {
    try {
      const job = await getJob(request.params.jobId);

      if (!job) {
        response.status(404).json({ error: "job_not_found" });
        return;
      }

      response.json(job);
    } catch (error) {
      next(error);
    }
  });

  app.get("/jobs/:jobId/messages", async (request, response, next) => {
    try {
      const job = await getJob(request.params.jobId);

      if (!job) {
        response.status(404).json({ error: "job_not_found" });
        return;
      }

      const messages = await getGroupMessagesForJob(request.params.jobId);
      response.json({
        jobId: job.id,
        ingressOrigin: job.ingressOrigin,
        messages
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/jobs/:jobId/cancel", async (request, response, next) => {
    try {
      const input = cancelJobSchema.parse(request.body ?? {});
      const result = await cancelJob({
        jobId: request.params.jobId,
        reason: input.reason,
        requesterId: input.requesterId
      });

      if (!result.job) {
        response.status(404).json({ error: "job_not_found" });
        return;
      }

      if (result.reason === "already_terminal") {
        response.status(409).json({
          error: "job_already_terminal",
          jobId: result.job.id,
          status: result.job.status
        });
        return;
      }

      response.json({
        ok: true,
        changed: result.changed,
        reason: result.reason,
        jobId: result.job.id,
        status: result.job.status
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/jobs/:jobId/plan", async (request, response, next) => {
    try {
      const input = createJobPlanSchema.parse(request.body ?? {});
      const plan = await createPlanForJob(request.params.jobId, input);
      if (!plan) {
        response.status(404).json({ error: "job_not_found" });
        return;
      }
      response.status(201).json(plan);
    } catch (error) {
      next(error);
    }
  });

  app.get("/jobs/:jobId/details", async (request, response, next) => {
    try {
      const details = await getJobDetails(request.params.jobId);

      if (!details.job) {
        response.status(404).json({ error: "job_not_found" });
        return;
      }

      response.json(details);
    } catch (error) {
      next(error);
    }
  });

  app.get("/jobs/:jobId/timeline", async (request, response, next) => {
    try {
      const query = timelineQuerySchema.parse(request.query);
      const timeline = await getJobTimeline(request.params.jobId, {
        limit: query.limit,
        since: query.since,
        cursor: query.cursor
      });

      if (!timeline.job) {
        response.status(404).json({ error: "job_not_found" });
        return;
      }

      response.json(timeline);
    } catch (error) {
      if (error instanceof InvalidTimelineCursorError) {
        response.status(400).json({ error: error.message });
        return;
      }

      next(error);
    }
  });

  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    if (error instanceof z.ZodError) {
      response.status(400).json({ error: "invalid_request", issues: error.issues });
      return;
    }

    if (error instanceof WorkspacePathError) {
      response.status(400).json({ error: error.message });
      return;
    }

    if (error instanceof WebFetchError) {
      response.status(error.code === "private_network_blocked" ? 403 : 400).json({
        error: error.code,
        message: error.message,
        details: error.details
      });
      return;
    }

    if (error instanceof McpToolError) {
      response.status(400).json({
        error: error.code,
        message: error.message,
        details: error.details
      });
      return;
    }

    if (error instanceof OpenClawSyncSafetyError) {
      response.status(409).json({
        error: error.code,
        message: error.message,
        details: error.details
      });
      return;
    }

    console.error(error);
    response.status(500).json({ error: "internal_error" });
  });

  const httpServer = app.listen(port, host, () => {
    console.log(`Orchestrator API listening on http://${host}:${port}`);
  });

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    console.log(`Received ${signal}, shutting down orchestrator API`);

    const forceExitTimer = setTimeout(() => {
      console.error("Graceful shutdown timed out, forcing exit");
      process.exit(1);
    }, 10_000);
    forceExitTimer.unref();

    closeAllMcpSessions();
    httpServer.close(() => {
      void closePool()
        .catch((error) => {
          console.error("Failed to close database pool", error);
        })
        .finally(() => {
          process.exit(0);
        });
    });
    httpServer.closeAllConnections();
  };

  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
