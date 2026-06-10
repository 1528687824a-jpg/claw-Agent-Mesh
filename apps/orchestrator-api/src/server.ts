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
  EXPERIENCE_STATUSES,
  INGRESS_ORIGINS,
  JOB_STATUSES,
  ROUTING_MODES,
  TASK_PLAN_ITEM_STATUSES,
  TASK_PLAN_STATUSES,
  TOOL_APPROVAL_STATUSES,
  TOOL_RISK_LEVELS,
  type ExperienceStatus
} from "../../../packages/shared/src/types";
import { launchDbos, startJobWorkflow } from "./dbos-runtime";
import { ingressAdapters } from "./adapters";
import { getRuntimeCapabilities } from "./capabilities";

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
const WORKSPACE_COMMAND_TOOL_NAMES = new Set([
  "workspace.runCommand",
  "workspace.command",
  "workspace.shell"
]);
const WORKSPACE_COMMAND_ACTION_TYPES = new Set([
  "command_execute",
  "workspace_command_execute"
]);

function normalizeApprovalTarget(target: string | null) {
  if (!target) {
    return null;
  }
  return target.trim().replace(/\\/g, "/").replace(/^\/+/, "").replace(/^\.\//, "");
}

function normalizeApprovalCommand(command: string | null) {
  return command?.trim() || null;
}

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
  if (actualToken !== expectedToken) {
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
  const corsOrigins = getCorsOrigins();

  app.use((request, response, next) => {
    const origin = request.header("origin");
    if (origin && corsOrigins.includes(origin)) {
      response.header("access-control-allow-origin", origin);
      response.header("vary", "Origin");
      response.header("access-control-allow-methods", "GET,POST,PATCH,OPTIONS");
      response.header("access-control-allow-headers", "content-type,x-admin-token");
    }

    if (request.method === "OPTIONS") {
      response.sendStatus(204);
      return;
    }

    next();
  });

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

  app.get("/workspaces/inspect", async (request, response, next) => {
    try {
      const query = workspaceRootQuerySchema.parse(request.query);
      response.json(await inspectWorkspace(query.rootPath));
    } catch (error) {
      next(error);
    }
  });

  app.get("/workspaces/files", async (request, response, next) => {
    try {
      const query = workspaceFilesQuerySchema.parse(request.query);
      response.json(
        await listWorkspaceFiles(query.rootPath, {
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
      response.json(
        await readWorkspaceFile(query.rootPath, {
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
      const target = await prepareWorkspaceFileWrite(input.rootPath, {
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

      const result = await writeWorkspaceFile(input.rootPath, {
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
      const cwd = await resolveWorkspaceDirectoryTarget(input.rootPath, input.cwdSubpath ?? ".");
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

      const result = await runWorkspaceCommand(input.rootPath, {
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

  app.get("/workspaces/git/status", async (request, response, next) => {
    try {
      const query = workspaceRootQuerySchema.parse(request.query);
      response.json(await getWorkspaceGitStatus(query.rootPath));
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
      decidedBy: input.decidedBy ?? "desktop-app",
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

    console.error(error);
    response.status(500).json({ error: "internal_error" });
  });

  app.listen(port, () => {
    console.log(`Orchestrator API listening on http://localhost:${port}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
