import { randomUUID } from "node:crypto";
import {
  TOOL_APPROVAL_STATUSES,
  TOOL_RISK_LEVELS,
  type ToolApprovalRecord,
  type ToolApprovalStatus,
  type ToolRiskLevel
} from "../../shared/src/types";
import { appendJobEvent, getJob, getJobBySessionId } from "./jobs";
import { pool } from "./pool";

const DEFAULT_APPROVAL_TTL_MS = Number(process.env.HONEYCOMB_APPROVAL_TTL_MS ?? 15 * 60 * 1000);

function normalizeApprovalStatus(value: unknown): ToolApprovalStatus {
  return typeof value === "string" && (TOOL_APPROVAL_STATUSES as readonly string[]).includes(value)
    ? (value as ToolApprovalStatus)
    : "pending";
}

function normalizeRiskLevel(value: unknown): ToolRiskLevel {
  return typeof value === "string" && (TOOL_RISK_LEVELS as readonly string[]).includes(value)
    ? (value as ToolRiskLevel)
    : "medium";
}

function toToolApprovalRecord(row: any): ToolApprovalRecord {
  return {
    id: row.id,
    jobId: row.job_id,
    sessionId: row.session_id,
    stageId: row.stage_id,
    agentId: row.agent_id,
    requesterActor: row.requester_actor,
    toolName: row.tool_name,
    actionType: row.action_type,
    riskLevel: normalizeRiskLevel(row.risk_level),
    reason: row.reason,
    command: row.command,
    target: row.target,
    input: row.input ?? {},
    policy: row.policy ?? {},
    status: normalizeApprovalStatus(row.status),
    decisionReason: row.decision_reason,
    decidedBy: row.decided_by,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    expiresAt: row.expires_at ? row.expires_at.toISOString() : null,
    decidedAt: row.decided_at ? row.decided_at.toISOString() : null,
    consumedAt: row.consumed_at ? row.consumed_at.toISOString() : null
  };
}

async function resolveJob(input: { jobId?: string; sessionId?: string }) {
  if (input.jobId) {
    return getJob(input.jobId);
  }

  if (input.sessionId) {
    return getJobBySessionId(input.sessionId);
  }

  return null;
}

function defaultExpiresAt() {
  const ttlMs = Number.isFinite(DEFAULT_APPROVAL_TTL_MS) && DEFAULT_APPROVAL_TTL_MS > 0
    ? DEFAULT_APPROVAL_TTL_MS
    : 15 * 60 * 1000;
  return new Date(Date.now() + ttlMs).toISOString();
}

function isApprovalExpired(approval: ToolApprovalRecord, now = new Date()) {
  return approval.expiresAt ? Date.parse(approval.expiresAt) <= now.getTime() : false;
}

async function markToolApprovalExpired(approvalId: string): Promise<ToolApprovalRecord | null> {
  const result = await pool.query(
    `update agent.tool_approval_requests
     set status = 'expired',
         updated_at = now()
     where id = $1
       and status in ('pending', 'approved')
       and expires_at is not null
       and expires_at <= now()
     returning *`,
    [approvalId]
  );

  if (!result.rows[0]) {
    return getToolApproval(approvalId);
  }

  const approval = toToolApprovalRecord(result.rows[0]);
  await appendJobEvent(
    approval.jobId,
    "tool.approval_expired",
    {
      approvalId: approval.id,
      toolName: approval.toolName,
      actionType: approval.actionType,
      riskLevel: approval.riskLevel
    },
    {
      actor: "tool-gateway",
      stageId: approval.stageId
    }
  );
  return approval;
}

export async function createToolApprovalRequest(input: {
  jobId?: string;
  sessionId?: string;
  stageId?: string | null;
  agentId: string;
  requesterActor?: string;
  toolName: string;
  actionType: string;
  riskLevel?: ToolRiskLevel;
  reason?: string | null;
  command?: string | null;
  target?: string | null;
  input?: Record<string, unknown>;
  policy?: Record<string, unknown>;
  expiresAt?: string | null;
  id?: string;
}): Promise<ToolApprovalRecord | null> {
  const job = await resolveJob(input);
  if (!job) {
    return null;
  }

  const id = input.id ?? `APR-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${randomUUID()
    .slice(0, 8)
    .toUpperCase()}`;
  const result = await pool.query(
    `insert into agent.tool_approval_requests (
      id,
      job_id,
      session_id,
      stage_id,
      agent_id,
      requester_actor,
      tool_name,
      action_type,
      risk_level,
      reason,
      command,
      target,
      input,
      policy,
      expires_at
    ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14::jsonb, $15::timestamptz)
    returning *`,
    [
      id,
      job.id,
      job.sessionId,
      input.stageId ?? null,
      input.agentId,
      input.requesterActor ?? "tool-gateway",
      input.toolName,
      input.actionType,
      input.riskLevel ?? "medium",
      input.reason ?? null,
      input.command ?? null,
      input.target ?? null,
      JSON.stringify(input.input ?? {}),
      JSON.stringify(input.policy ?? {}),
      input.expiresAt ?? defaultExpiresAt()
    ]
  );

  const approval = toToolApprovalRecord(result.rows[0]);
  await appendJobEvent(
    job.id,
    "tool.approval_requested",
    {
      approvalId: approval.id,
      toolName: approval.toolName,
      actionType: approval.actionType,
      riskLevel: approval.riskLevel,
      agentId: approval.agentId,
      target: approval.target,
      expiresAt: approval.expiresAt
    },
    {
      actor: approval.requesterActor,
      stageId: approval.stageId
    }
  );

  return approval;
}

export async function getToolApproval(approvalId: string): Promise<ToolApprovalRecord | null> {
  const result = await pool.query(`select * from agent.tool_approval_requests where id = $1`, [
    approvalId
  ]);
  return result.rows[0] ? toToolApprovalRecord(result.rows[0]) : null;
}

export async function listToolApprovals(input: {
  status?: ToolApprovalStatus;
  jobId?: string;
  sessionId?: string;
  agentId?: string;
  riskLevel?: ToolRiskLevel;
  limit?: number;
} = {}): Promise<{
  approvals: ToolApprovalRecord[];
  filters: {
    status: ToolApprovalStatus | null;
    jobId: string | null;
    sessionId: string | null;
    agentId: string | null;
    riskLevel: ToolRiskLevel | null;
    limit: number;
  };
}> {
  const values: unknown[] = [];
  const where: string[] = [];
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 200);

  if (input.status) {
    values.push(input.status);
    where.push(`status = $${values.length}`);
  }
  if (input.jobId) {
    values.push(input.jobId);
    where.push(`job_id = $${values.length}`);
  }
  if (input.sessionId) {
    values.push(input.sessionId);
    where.push(`session_id = $${values.length}`);
  }
  if (input.agentId) {
    values.push(input.agentId);
    where.push(`agent_id = $${values.length}`);
  }
  if (input.riskLevel) {
    values.push(input.riskLevel);
    where.push(`risk_level = $${values.length}`);
  }
  values.push(limit);

  const result = await pool.query(
    `select *
     from agent.tool_approval_requests
     ${where.length ? `where ${where.join(" and ")}` : ""}
     order by updated_at desc, id desc
     limit $${values.length}`,
    values
  );

  return {
    approvals: result.rows.map(toToolApprovalRecord),
    filters: {
      status: input.status ?? null,
      jobId: input.jobId ?? null,
      sessionId: input.sessionId ?? null,
      agentId: input.agentId ?? null,
      riskLevel: input.riskLevel ?? null,
      limit
    }
  };
}

export async function decideToolApproval(input: {
  approvalId: string;
  status: "approved" | "rejected" | "cancelled";
  decidedBy: string;
  decisionReason?: string | null;
}): Promise<{
  approval: ToolApprovalRecord | null;
  changed: boolean;
  reason: "not_found" | "not_pending" | "expired" | "updated";
}> {
  const existing = await getToolApproval(input.approvalId);
  if (!existing) {
    return {
      approval: null,
      changed: false,
      reason: "not_found"
    };
  }

  if (existing.status !== "pending") {
    return {
      approval: existing,
      changed: false,
      reason: "not_pending"
    };
  }

  if (isApprovalExpired(existing)) {
    return {
      approval: await markToolApprovalExpired(input.approvalId),
      changed: true,
      reason: "expired"
    };
  }

  const result = await pool.query(
    `update agent.tool_approval_requests
     set status = $2,
         decision_reason = $3,
         decided_by = $4,
         decided_at = now(),
         updated_at = now()
     where id = $1 and status = 'pending'
     returning *`,
    [input.approvalId, input.status, input.decisionReason ?? null, input.decidedBy]
  );

  if (!result.rows[0]) {
    return {
      approval: await getToolApproval(input.approvalId),
      changed: false,
      reason: "not_pending"
    };
  }

  const approval = toToolApprovalRecord(result.rows[0]);
  await appendJobEvent(
    approval.jobId,
    `tool.approval_${input.status}`,
    {
      approvalId: approval.id,
      toolName: approval.toolName,
      actionType: approval.actionType,
      riskLevel: approval.riskLevel,
      decidedBy: approval.decidedBy,
      decisionReason: approval.decisionReason
    },
    {
      actor: input.decidedBy,
      stageId: approval.stageId
    }
  );

  return {
    approval,
    changed: true,
    reason: "updated"
  };
}

export async function consumeToolApproval(input: {
  approvalId: string;
  consumedBy?: string;
}): Promise<{
  approval: ToolApprovalRecord | null;
  changed: boolean;
  reason: "not_found" | "not_approved" | "expired" | "updated";
}> {
  const existing = await getToolApproval(input.approvalId);
  if (!existing) {
    return {
      approval: null,
      changed: false,
      reason: "not_found"
    };
  }

  if (existing.status !== "approved") {
    return {
      approval: existing,
      changed: false,
      reason: "not_approved"
    };
  }

  if (isApprovalExpired(existing)) {
    return {
      approval: await markToolApprovalExpired(input.approvalId),
      changed: true,
      reason: "expired"
    };
  }

  const result = await pool.query(
    `update agent.tool_approval_requests
     set status = 'consumed',
         consumed_at = now(),
         updated_at = now()
     where id = $1 and status = 'approved'
     returning *`,
    [input.approvalId]
  );

  if (!result.rows[0]) {
    return {
      approval: await getToolApproval(input.approvalId),
      changed: false,
      reason: "not_approved"
    };
  }

  const approval = toToolApprovalRecord(result.rows[0]);
  await appendJobEvent(
    approval.jobId,
    "tool.approval_consumed",
    {
      approvalId: approval.id,
      toolName: approval.toolName,
      actionType: approval.actionType,
      consumedBy: input.consumedBy ?? null
    },
    {
      actor: input.consumedBy ?? "tool-gateway",
      stageId: approval.stageId
    }
  );

  return {
    approval,
    changed: true,
    reason: "updated"
  };
}

export async function expirePendingToolApprovals(now = new Date()): Promise<number> {
  const result = await pool.query(
    `update agent.tool_approval_requests
     set status = 'expired',
         updated_at = now()
     where status in ('pending', 'approved')
       and expires_at is not null
       and expires_at <= $1::timestamptz`,
    [now.toISOString()]
  );

  return result.rowCount ?? 0;
}
